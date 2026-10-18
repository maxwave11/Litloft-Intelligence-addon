"""Channel-scoped search and the migrations that make it possible.

A channel has to narrow the search *before* each retrieval channel takes
its top-N: filtering the merged result loses every file that did not
already make that cut (measured: 10 results → 2 after a post-filter).
The vector tables therefore carry the channel as a vec0 partition key,
which sqlite-vec consults during the KNN scan, and the FTS channels carry
a file_id predicate inside their MATCH query.
"""

import os
import struct
from contextlib import contextmanager
from dataclasses import replace

import numpy as np
import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

import app.config as cfg
from app.config import SearchConfig
from app.database import Base
from app.models import Embedding, IndexedFile


def _vec_extension() -> str | None:
    """The loadable sqlite-vec extension, in either naming CI uses.

    The production image names the file ``vec0`` (which is what the
    addon's ``_load_sqlite_vec`` loads); the test image's ``make
    loadable`` leaves it as ``vec0.so``. Accept both rather than skip
    silently on the official image.
    """
    base = os.environ.get("SQLITE_VEC_PATH", "/usr/local/lib/sqlite-vec/vec0")
    for candidate in (base, f"{base}.so"):
        if os.path.exists(candidate):
            return candidate
    return None


VEC_EXT = _vec_extension()
needs_vec = pytest.mark.skipif(
    VEC_EXT is None,
    reason="sqlite-vec extension not installed",
)


def _load_vec(dbapi_conn, _record) -> None:
    dbapi_conn.enable_load_extension(True)
    dbapi_conn.load_extension(VEC_EXT)
    dbapi_conn.enable_load_extension(False)

DIM = 4


def _vec(*values: float) -> bytes:
    return struct.pack(f"{len(values)}f", *values)


def _patch_retrieval(monkeypatch, engine, *, relaxed: bool = True):
    """Point search at ``engine`` and drop the scoring heuristics.

    The thresholds exist to separate a real hit from noise; these tests
    care about *which files are reachable at all*, so leaving them on
    would let a cutoff mask a scoping bug.
    """
    import app.search as search_mod

    Session_ = sessionmaker(bind=engine, expire_on_commit=False)

    @contextmanager
    def _read():
        session = Session_()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr("app.search.get_search_db_read", _read)
    monkeypatch.setattr("app.search.get_search_engine", lambda: engine)
    if relaxed:
        monkeypatch.setattr(
            search_mod,
            "settings",
            replace(
                cfg.settings,
                search=SearchConfig(
                    min_score_text=0.0,
                    score_gap_threshold=0.0,
                    score_cutoff_margin=2.0,
                ),
            ),
        )
    return Session_


def _add_file(session: Session, file_id: str, channel: str) -> None:
    session.add(IndexedFile(
        file_id=file_id,
        drive="videos",
        filename=f"{file_id}.mp4",
        file_path=f"/videos/{file_id}.mp4",
        file_type="video",
        mime_type="video/mp4",
        file_size=1,
        active=True,
        channel=channel,
    ))


@contextmanager
def _vec_engine(tmp_path):
    """Real search DB whose ``vec_text`` carries the channel partition."""
    engine = create_engine(f"sqlite:///{tmp_path / 'search.db'}")
    event.listen(engine, "connect", _load_vec)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE vec_text USING vec0("
            "embedding_id TEXT PRIMARY KEY, "
            "channel TEXT PARTITION KEY, vector float[4])"
        ))
    try:
        yield engine
    finally:
        engine.dispose()


@contextmanager
def _fts_engine(tmp_path):
    """Search DB with the trigram file index and no vector tables."""
    engine = create_engine(f"sqlite:///{tmp_path / 'search.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE fts_files "
            "USING fts5(file_id, filename, title, description, tags_text, "
            "tokenize='trigram')"
        ))
    try:
        yield engine
    finally:
        engine.dispose()


# ---------------------------------------------------------------------------
# Vector channel: the partition narrows the KNN
# ---------------------------------------------------------------------------


@needs_vec
def test_vector_search_returns_only_the_requested_channel(
    tmp_path, monkeypatch
):
    from app.search import _vector_search_text

    with _vec_engine(tmp_path) as engine:
        _patch_retrieval(monkeypatch, engine)
        with Session(engine) as session:
            _add_file(session, "zro1", "ZROBIM")
            _add_file(session, "tim1", "Тим Building")
            session.add(Embedding(
                id="e_zro", file_id="zro1", embedding_type="metadata",
                vector_table="vec_text", content_preview="foundation",
            ))
            session.add(Embedding(
                id="e_tim", file_id="tim1", embedding_type="metadata",
                vector_table="vec_text", content_preview="foundation",
            ))
            session.commit()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO vec_text(embedding_id, channel, vector) "
                     "VALUES(:i, :c, :v)"),
                [
                    {"i": "e_zro", "c": "ZROBIM", "v": _vec(1, 0, 0, 0)},
                    {"i": "e_tim", "c": "Тим Building", "v": _vec(0.8, 0.6, 0, 0)},
                ],
            )

        query = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)

        scoped = _vector_search_text(query, 50, channel="ZROBIM")
        assert {m.file_id for m in scoped} == {"zro1"}

        everything = _vector_search_text(query, 50)
        assert {m.file_id for m in everything} == {"zro1", "tim1"}


@needs_vec
def test_vector_search_unknown_channel_is_empty(tmp_path, monkeypatch):
    from app.search import _vector_search_text

    with _vec_engine(tmp_path) as engine:
        _patch_retrieval(monkeypatch, engine)
        with Session(engine) as session:
            _add_file(session, "zro1", "ZROBIM")
            session.add(Embedding(
                id="e_zro", file_id="zro1", embedding_type="metadata",
                vector_table="vec_text", content_preview="foundation",
            ))
            session.commit()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO vec_text(embedding_id, channel, vector) "
                     "VALUES(:i, :c, :v)"),
                {"i": "e_zro", "c": "ZROBIM", "v": _vec(1, 0, 0, 0)},
            )

        query = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)
        assert _vector_search_text(query, 50, channel="Нет такого") == []


@needs_vec
def test_insert_vector_takes_its_channel_from_indexed_files(tmp_path):
    from app.database import insert_vector

    with _vec_engine(tmp_path) as engine:
        with Session(engine) as session:
            _add_file(session, "f1", "ZROBIM")
            session.commit()
        with engine.begin() as conn:
            insert_vector(
                conn,
                table="vec_text",
                embedding_id="e1",
                file_id="f1",
                vector=_vec(1, 0, 0, 0),
            )
            channels = conn.execute(
                text("SELECT channel FROM vec_text WHERE embedding_id = 'e1'")
            ).fetchall()

        assert [row[0] for row in channels] == ["ZROBIM"]


@needs_vec
def test_create_vec_tables_partitions_by_channel(tmp_path):
    from app.database import _create_vec_tables

    engine = create_engine(f"sqlite:///{tmp_path / 'search.db'}")
    event.listen(engine, "connect", _load_vec)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        _create_vec_tables(conn)
        for table in ("vec_text", "vec_clip"):
            sql = conn.execute(
                text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:n"),
                {"n": table},
            ).fetchone()[0]
            assert "PARTITION KEY" in sql.upper(), table


# ---------------------------------------------------------------------------
# FTS channels: the channel predicate rides inside the MATCH query
# ---------------------------------------------------------------------------


def test_keyword_search_is_scoped_to_one_channel(tmp_path, monkeypatch):
    from app.search import _keyword_search

    with _fts_engine(tmp_path) as engine:
        _patch_retrieval(monkeypatch, engine)
        with Session(engine) as session:
            _add_file(session, "f_zro", "ZROBIM")
            _add_file(session, "f_tim", "Тим Building")
            session.commit()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO fts_files(file_id, filename, title, "
                     "description, tags_text) VALUES(:f, :n, :t, :d, :g)"),
                [
                    {"f": "f_zro", "n": "fundament.mp4", "t": "Фундамент",
                     "d": "как выбрать фундамент", "g": ""},
                    {"f": "f_tim", "n": "fundament-tim.mp4", "t": "Фундамент",
                     "d": "как выбрать фундамент", "g": ""},
                ],
            )

        scoped = _keyword_search("фундамент", 50, channel="ZROBIM")
        assert {m.file_id for m in scoped} == {"f_zro"}

        everything = _keyword_search("фундамент", 50)
        assert {m.file_id for m in everything} == {"f_zro", "f_tim"}


def test_search_with_blank_channel_returns_nothing(tmp_path, monkeypatch):
    """A blank channel must not degrade into a whole-drive search."""
    from app.search import search

    with _fts_engine(tmp_path) as engine:
        _patch_retrieval(monkeypatch, engine)
        with Session(engine) as session:
            _add_file(session, "f_zro", "ZROBIM")
            session.commit()

        result = search("фундамент", channel="   ")

        assert result.results == ()
        assert result.total == 0


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------


def test_indexed_files_channel_column_is_added_once(tmp_path):
    from app.database import _migrate_indexed_files_channel_if_needed

    engine = create_engine(f"sqlite:///{tmp_path / 'search.db'}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE indexed_files ("
            "  file_id TEXT PRIMARY KEY,"
            "  drive TEXT NOT NULL"
            ")"
        ))

    for _ in range(2):
        with engine.begin() as conn:
            _migrate_indexed_files_channel_if_needed(conn)

    with engine.connect() as conn:
        cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(indexed_files)"))
        }
    assert "channel" in cols


@needs_vec
def test_vec_migration_partitions_an_old_table(tmp_path):
    """An unpartitioned ``vec_text`` is rebuilt in place, vectors intact."""
    from app.vec_partition import migrate_if_needed

    db_path = tmp_path / "search.db"
    engine = create_engine(f"sqlite:///{db_path}")
    event.listen(engine, "connect", _load_vec)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE vec_text USING vec0("
            "embedding_id TEXT PRIMARY KEY, vector float[4])"
        ))
        conn.execute(
            text("INSERT INTO vec_text(embedding_id, vector) VALUES(:i, :v)"),
            [
                {"i": "e1", "v": _vec(1, 0, 0, 0)},
                {"i": "e2", "v": _vec(0, 1, 0, 0)},
            ],
        )
    with Session(engine) as session:
        _add_file(session, "f1", "ZROBIM")
        _add_file(session, "f2", "Тим Building")
        session.add(Embedding(
            id="e1", file_id="f1", embedding_type="metadata",
            vector_table="vec_text", content_preview="a",
        ))
        session.add(Embedding(
            id="e2", file_id="f2", embedding_type="metadata",
            vector_table="vec_text", content_preview="b",
        ))
        session.commit()

    migrate_if_needed(engine, str(db_path))

    with engine.connect() as conn:
        sql = conn.execute(text(
            "SELECT sql FROM sqlite_master "
            "WHERE type='table' AND name='vec_text'"
        )).fetchone()[0]
        rows = conn.execute(text(
            "SELECT embedding_id, channel FROM vec_text ORDER BY embedding_id"
        )).fetchall()
        scoped = conn.execute(text(
            "SELECT embedding_id FROM vec_text "
            "WHERE channel = 'ZROBIM' AND vector MATCH :vec "
            "ORDER BY distance LIMIT 5"
        ), {"vec": _vec(1, 0, 0, 0)}).fetchall()
        names = [
            row[0] for row in conn.execute(text(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ))
        ]
    engine.dispose()

    assert "PARTITION KEY" in sql.upper()
    assert rows == [("e1", "ZROBIM"), ("e2", "Тим Building")]
    assert [r[0] for r in scoped] == ["e1"]
    assert [n for n in names if n.endswith("_migrate")] == []


@needs_vec
def test_vec_migration_is_idempotent(tmp_path):
    from app.vec_partition import migrate_if_needed

    db_path = tmp_path / "search.db"
    engine = create_engine(f"sqlite:///{db_path}")
    event.listen(engine, "connect", _load_vec)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE vec_text USING vec0("
            "embedding_id TEXT PRIMARY KEY, "
            "channel TEXT PARTITION KEY, vector float[4])"
        ))

    migrate_if_needed(engine, str(db_path))
    migrate_if_needed(engine, str(db_path))

    with engine.connect() as conn:
        sql = conn.execute(text(
            "SELECT sql FROM sqlite_master "
            "WHERE type='table' AND name='vec_text'"
        )).fetchone()[0]
    engine.dispose()

    assert "PARTITION KEY" in sql.upper()
    assert sql.count("PARTITION KEY") == 1


@needs_vec
def test_migration_probe_reads_the_dimension_of_an_old_table(tmp_path):
    """The ``float[N]`` read must not be confused by the partition key's
    ``TEXT``, and a table that already carries the partition is left alone."""
    from app.vec_partition import _pending_tables

    with _vec_engine(tmp_path) as engine:
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE VIRTUAL TABLE vec_clip USING vec0("
                "embedding_id TEXT PRIMARY KEY, vector float[4])"
            ))
        raw = engine.raw_connection()
        try:
            pending = _pending_tables(raw.driver_connection)
        finally:
            raw.close()

    assert pending == [("vec_clip", DIM)]


@needs_vec
def test_a_failure_after_the_drop_leaves_the_database_exactly_as_it_was(
    tmp_path, monkeypatch,
):
    """A failure mid-rebuild must leave no trace of the attempt.

    Pins the shape the production DB hit. Under the old code the whole
    rebuild ran in a pysqlite-managed transaction, so DDL committed on its
    own: a failure at the last statement — a ``DROP`` of the vec0 staging
    table, which is exactly where production died — threw the run away while
    the staging table stayed behind, forever. The explicit ``BEGIN IMMEDIATE``
    in ``migrate_if_needed`` is what makes the rebuild one unit.
    """
    from app import vec_partition

    db_path = tmp_path / "search.db"
    engine = create_engine(f"sqlite:///{db_path}")
    event.listen(engine, "connect", _load_vec)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE vec_text USING vec0("
            "embedding_id TEXT PRIMARY KEY, vector float[4])"
        ))
        conn.execute(
            text("INSERT INTO vec_text(embedding_id, vector) VALUES(:i, :v)"),
            [
                {"i": "e1", "v": _vec(1, 0, 0, 0)},
                {"i": "e2", "v": _vec(0, 1, 0, 0)},
            ],
        )
    with Session(engine) as session:
        _add_file(session, "f1", "ZROBIM")
        session.add(Embedding(
            id="e1", file_id="f1", embedding_type="metadata",
            vector_table="vec_text", content_preview="a",
        ))
        session.commit()

    def before_and_after() -> tuple[str, list[str], list[str]]:
        with engine.connect() as conn:
            sql = conn.execute(text(
                "SELECT sql FROM sqlite_master "
                "WHERE type='table' AND name='vec_text'"
            )).fetchone()[0]
            ids = [
                r[0] for r in conn.execute(text(
                    "SELECT embedding_id FROM vec_text ORDER BY embedding_id"
                ))
            ]
            tables = [r[0] for r in conn.execute(text(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ))]
        return sql, ids, tables

    sql_before, ids_before, tables_before = before_and_after()

    # Break the CREATE that follows the DROP.
    original = vec_partition.vec_table_ddl

    def explode(name: str, dim: int, **kwargs) -> str:
        if name == "vec_text":
            raise RuntimeError("simulated failure after the DROP")
        return original(name, dim, **kwargs)

    monkeypatch.setattr(vec_partition, "vec_table_ddl", explode)
    with pytest.raises(RuntimeError):
        vec_partition.migrate_if_needed(engine, str(db_path))

    sql_after, ids_after, tables_after = before_and_after()
    engine.dispose()

    assert sql_after == sql_before
    assert ids_after == ids_before
    # Not "no _migrate table": the whole table set, so a leftover under any
    # name — the old code's ``vec_text_channel`` included — fails here.
    assert sorted(tables_after) == sorted(tables_before)


@needs_vec
def test_less_free_disk_than_four_times_the_vectors_refuses_and_writes_nothing(
    tmp_path, monkeypatch, caplog,
):
    """The free-space check runs before BEGIN, so a refusal touches nothing."""
    import collections
    import shutil

    from app import vec_partition

    Usage = collections.namedtuple("Usage", "total used free")

    db_path = tmp_path / "search.db"
    engine = create_engine(f"sqlite:///{db_path}")
    event.listen(engine, "connect", _load_vec)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE vec_text USING vec0("
            "embedding_id TEXT PRIMARY KEY, vector float[4])"
        ))
        conn.execute(
            text("INSERT INTO vec_text(embedding_id, vector) VALUES(:i, :v)"),
            [{"i": f"e{n}", "v": _vec(1, 0, 0, 0)} for n in range(4)],
        )
    with engine.connect() as conn:
        sql_before = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_text'"
        )).fetchone()[0]

    # 4 rows x 4 dims x 4 bytes = 64 bytes of vectors; offer one byte less
    # than the fourfold the migration asks for.
    monkeypatch.setattr(shutil, "disk_usage", lambda path: Usage(10**12, 0, 4 * 64 - 1))

    caplog.set_level("INFO")
    with pytest.raises(RuntimeError, match="Not enough free disk"):
        vec_partition.migrate_if_needed(engine, str(db_path))

    with engine.connect() as conn:
        sql_after = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_text'"
        )).fetchone()[0]
        rows = conn.execute(text("SELECT count(*) FROM vec_text")).fetchone()[0]
    engine.dispose()

    assert any("not enough free disk" in r.getMessage() for r in caplog.records)
    assert not any("migration: start" in r.getMessage() for r in caplog.records)
    assert sql_after == sql_before
    assert rows == 4


def test_backfill_takes_channels_from_core_and_strips_them(tmp_path):
    from app import database

    search_engine = create_engine(f"sqlite:///{tmp_path / 'search.db'}")
    Base.metadata.create_all(search_engine)
    core_engine = create_engine(f"sqlite:///{tmp_path / 'litloft.db'}")
    with core_engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE loft_metadata (file_id TEXT PRIMARY KEY, channel TEXT)"
        ))
        conn.execute(
            text("INSERT INTO loft_metadata(file_id, channel) VALUES(:f, :c)"),
            [
                {"f": "f1", "c": "ZROBIM"},
                {"f": "f2", "c": "Сергей Зенков Архитектор "},
                {"f": "f3", "c": ""},
            ],
        )
    with Session(search_engine) as session:
        _add_file(session, "f1", "")
        _add_file(session, "f2", "")
        _add_file(session, "f4", "")
        session.commit()

    original = database._litloft_engine
    database._litloft_engine = core_engine
    try:
        with search_engine.begin() as conn:
            database._backfill_channels_from_litloft(conn)
    finally:
        database._litloft_engine = original

    with search_engine.connect() as conn:
        channels = dict(conn.execute(text(
            "SELECT file_id, channel FROM indexed_files"
        )).fetchall())

    assert channels["f1"] == "ZROBIM"
    assert channels["f2"] == "Сергей Зенков Архитектор"
    assert channels["f4"] == ""
