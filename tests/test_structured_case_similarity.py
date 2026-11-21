"""Supported structured ATT&CK evidence must not crash similarity retrieval."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from backend.main import app
from backend.services.semantic_search import _case_to_text, _recorded_technique_ids, find_similar_cases


def case(identity, techniques):
    return SimpleNamespace(id=identity, title='Gateway investigation', summary='Recorded command execution',
        attack_narrative=None, mitre_tactics=[{'id': 'TA0002', 'name': 'Execution'}, None, {'id': None}],
        mitre_techniques=techniques, severity='high', status='open')


def test_structured_search_text_includes_explicit_id_and_name_and_ignores_malformed_values():
    record = case(1, [{'id': 'T1059', 'name': 'Command and Scripting Interpreter'}, {'id': ['bad'], 'name': 4}, None])
    text = _case_to_text(record)
    assert 'T1059' in text and 'Command and Scripting Interpreter' in text
    assert 'Execution' in text and 'TA0002' in text
    assert 'None' not in text and "['bad']" not in text


def test_shared_evidence_requires_explicit_exact_ids_not_names_or_parent_guesses():
    assert _recorded_technique_ids([
        'T1059', {'id': 'T1059'}, {'id': 'T1059.001'}, {'name': 'T1078'}, None,
        {'id': ['T1021']}, ['T1078'], 'Command and Scripting Interpreter', 't1059', ' T1078',
    ]) == {'T1059', 'T1059.001'}
    assert _recorded_technique_ids({'id': 'T1059'}) == set()


def test_similarity_handles_mixed_saved_shapes_with_stable_shared_id_order_and_no_mutation():
    records = [case(9, [{'id': 'T1059'}, 'T1078', {'id': 'T1059.001'}]),
               case(3, ['T1078', {'id': 'T1059', 'name': None}]),
               case(2, [{'id': 'T1059'}, 'T1078'])]
    db = AsyncMock()
    db.execute.return_value = Mock()
    db.execute.return_value.scalars.return_value.all.return_value = records
    results = asyncio.run(find_similar_cases(db, user_id=7, target_case_id=9, min_similarity=0))
    assert {row['case_id'] for row in results} == {2, 3}
    assert all(row['shared_techniques'] == ['T1059', 'T1078'] for row in results)
    assert all('T1059.001' not in row['shared_techniques'] for row in results)
    assert all(row['ranking_method'] == 'lexical_tfidf_cosine' for row in results)
    assert all(len(row['shared_terms']) <= 8 for row in results)
    ordered = sorted(results, key=lambda row: (-row['similarity'], row['case_id']))
    assert [row['case_id'] for row in ordered] == [row['case_id'] for row in results]
    assert records[0].mitre_techniques == [{'id': 'T1059'}, 'T1078', {'id': 'T1059.001'}]
    statement = str(db.execute.call_args.args[0])
    assert 'cases.user_id =' in statement
    db.add.assert_not_called()
    db.commit.assert_not_awaited()


def test_route_reads_structured_records_and_never_returns_foreign_owner_cases(tmp_path):
    from fastapi.testclient import TestClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from backend.database.db import Base, get_async_db
    from backend.models.case import Case
    from backend.routers.auth import get_active_user

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'similarity.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([
                Case(id=1, user_id=7, title='Gateway command execution', summary='Recorded gateway command activity',
                     mitre_techniques=[{'id': 'T1059', 'name': 'Command Interpreter'}]),
                Case(id=2, user_id=7, title='Gateway command execution', summary='Recorded gateway command activity',
                     mitre_techniques=['T1059']),
                Case(id=3, user_id=7, title='Unrelated database issue', summary='Distinct authentication record',
                     mitre_techniques=['T1078']),
                Case(id=4, user_id=8, title='Foreign private record', summary='Gateway command execution',
                     mitre_techniques=[{'id': 'T1059'}]),
            ])
            await db.commit()
    asyncio.run(prepare())
    async def db_override():
        async with sessions() as db:
            yield db
    original = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = db_override
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=7)
    try:
        with TestClient(app) as client:
            response = client.get('/api/v1/cases/1/similar')
            assert response.status_code == 200
            data = response.json()['data']
            assert any(row['case_id'] == 2 and row['shared_techniques'] == ['T1059'] for row in data)
            assert all(row['case_id'] != 4 for row in data)
            assert client.get('/api/v1/cases/4/similar').json()['data'] == []
        async def verify():
            async with sessions() as db:
                assert (await db.get(Case, 1)).mitre_techniques == [
                    {'id': 'T1059', 'name': 'Command Interpreter'}]
        asyncio.run(verify())
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original)
        asyncio.run(engine.dispose())


def test_shared_terms_include_only_positive_ranking_contributors_in_weight_order():
    target = case(1, ['T1059'])
    target.title, target.summary, target.mitre_tactics = 'gateway gateway shell', 'gateway raremarker', []
    peer = case(2, ['T1059'])
    peer.title, peer.summary, peer.mitre_tactics = 'gateway gateway shell', 'gateway', []
    third = case(3, ['T1078'])
    third.title, third.summary, third.mitre_tactics = 'database credential', 'unrelated', []
    db = AsyncMock()
    db.execute.return_value = Mock()
    db.execute.return_value.scalars.return_value.all.return_value = [target, peer, third]
    result = asyncio.run(find_similar_cases(db, 7, 1, min_similarity=0))
    match = next(row for row in result if row['case_id'] == 2)
    assert match['shared_terms'][0] == 'gateway'
    assert set(match['shared_terms']) == {'gateway', 'shell', 't1059'}
    assert 'raremarker' not in match['shared_terms'] and 'high' not in match['shared_terms']
    assert next(row for row in result if row['case_id'] == 3)['shared_terms'] == []
