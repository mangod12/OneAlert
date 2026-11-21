"""Nested saved integration settings must not disclose or misroute masked values."""
from copy import deepcopy

import pytest

from backend.routers.integrations import MASKED_VALUE, _merge_config_update, mask_integration_config


def test_recursive_masking_covers_nested_objects_lists_and_non_string_secret_values():
    saved = {'index': 'security', 'auth': {'api_key': 'nested-key', 'name': 'service'},
             'targets': [{'name': 'A', 'password': 'nested-pass'}, {'token': {'value': 'object-secret'}}],
             'private_key': ['structured-secret'], 'routing_key': 12345, 'enabled': True,
             'credential': False, 'empty_password': '', 'null_secret': None}
    original = deepcopy(saved)
    public = mask_integration_config(saved)
    assert public['auth'] == {'api_key': MASKED_VALUE, 'name': 'service'}
    assert public['targets'] == [{'name': 'A', 'password': MASKED_VALUE}, {'token': MASKED_VALUE}]
    assert public['private_key'] == public['routing_key'] == public['credential'] == MASKED_VALUE
    assert public['empty_password'] == '' and public['null_secret'] is None
    assert public['index'] == 'security' and public['enabled'] is True
    assert saved == original


def test_nested_mask_round_trip_and_unrelated_setting_edit_preserve_original_values():
    saved = {'auth': {'token': 'nested-key', 'region': 'old'},
             'targets': [{'name': 'A', 'password': 'first'}, {'name': 'B', 'password': 'second'}],
             'private_key': {'format': 'example', 'value': 'structured'}, 'keep': 'unchanged'}
    original = deepcopy(saved)
    incoming = mask_integration_config(saved)
    incoming['auth']['region'] = 'new'
    merged = _merge_config_update(saved, incoming)
    assert merged == {**saved, 'auth': {'token': 'nested-key', 'region': 'new'}}
    assert saved == original
    assert _merge_config_update(saved, {'name': 'renamed'})['targets'] == saved['targets']


def test_nested_replacement_clear_and_omission_keep_existing_nonsecret_update_semantics():
    saved = {'auth': {'token': 'old', 'remove_me': True}, 'keep': 'untouched'}
    assert _merge_config_update(saved, {'auth': {'token': 'new'}}) == {
        'auth': {'token': 'new'}, 'keep': 'untouched'}
    assert _merge_config_update(saved, {'auth': None}) == {'auth': None, 'keep': 'untouched'}
    assert _merge_config_update(saved, {'auth': {'token': ''}})['auth']['token'] == ''
    assert _merge_config_update(saved, {'auth': {'token': None}})['auth']['token'] is None


@pytest.mark.parametrize('incoming', [
    [{'name': 'B', 'password': MASKED_VALUE}, {'name': 'A', 'password': MASKED_VALUE}],
    [{'name': 'renamed', 'password': MASKED_VALUE}, {'name': 'B', 'password': MASKED_VALUE}],
    [{'name': 'A', 'password': MASKED_VALUE}],
    [{'name': 'C', 'password': MASKED_VALUE}, {'name': 'A', 'password': MASKED_VALUE},
     {'name': 'B', 'password': MASKED_VALUE}],
])
def test_changed_masked_lists_fail_closed_instead_of_restoring_secrets_by_position(incoming):
    saved = {'targets': [{'name': 'A', 'password': 'first'}, {'name': 'B', 'password': 'second'}]}
    with pytest.raises(ValueError):
        _merge_config_update(saved, {'targets': incoming})
    assert saved['targets'][0]['password'] == 'first'


def test_explicit_complete_list_replacement_is_supported_without_reusing_saved_secrets():
    saved = {'targets': [{'name': 'A', 'password': 'first'}]}
    incoming = {'targets': [{'name': 'B', 'password': 'new'}, {'name': 'C', 'password': ''}]}
    assert _merge_config_update(saved, incoming) == incoming
    with pytest.raises(ValueError):
        _merge_config_update({}, {'auth': {'token': MASKED_VALUE}})


@pytest.mark.parametrize('key', ['shared_key', 'shared-key', 'SharedKey', 'Authorization', 'Cookie', 'Set-Cookie'])
def test_supported_signing_key_and_auth_header_names_are_masked_and_round_trip(key):
    saved = {'headers': {key: 'sensitive-synthetic-value'}}
    public = mask_integration_config(saved)
    assert public['headers'][key] == MASKED_VALUE
    assert _merge_config_update(saved, public) == saved
