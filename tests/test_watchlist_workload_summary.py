"""Full filtered watchlist workload summaries are not visible-page counts."""
from tests.test_watchlist_explorer import client as client
from tests.test_watchlist_explorer import fetch, seed


def test_summary_covers_all_matching_pages_not_just_twenty_five_rows(client):
    owner, follower, stranger, _ = seed(client)
    result = fetch(client, follower)
    assert len(result['data']) == 25 and result['total'] == 268
    assert result['summary'] == {'alerts': 134, 'cases': 134, 'active': 266,
                                 'done': 2, 'overdue': 2, 'active_without_due_date': 264}
    assert fetch(client, follower, page=9)['summary'] == result['summary']
    assert fetch(client, owner)['summary'] == dict.fromkeys(result['summary'], 0)
    assert fetch(client, stranger)['summary'] == {'alerts': 1, 'cases': 1, 'active': 2,
                                               'done': 0, 'overdue': 0, 'active_without_due_date': 2}


def test_summary_obeys_every_applied_filter_and_keeps_completed_due_dates_separate(client):
    _, follower, _, _ = seed(client)
    assert fetch(client, follower, kind='case', scope='overdue')['summary'] == {
        'alerts': 0, 'cases': 1, 'active': 1, 'done': 0, 'overdue': 1, 'active_without_due_date': 0}
    assert fetch(client, follower, scope='done')['summary'] == {
        'alerts': 1, 'cases': 1, 'active': 0, 'done': 2, 'overdue': 0, 'active_without_due_date': 0}
    assert fetch(client, follower, query='Record 134', kind='alert', severity='critical')['summary'] == {
        'alerts': 1, 'cases': 0, 'active': 1, 'done': 0, 'overdue': 1, 'active_without_due_date': 0}
    assert fetch(client, follower, query='%notpresent')['summary'] == {
        'alerts': 0, 'cases': 0, 'active': 0, 'done': 0, 'overdue': 0, 'active_without_due_date': 0}
