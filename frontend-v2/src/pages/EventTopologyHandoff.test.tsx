import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Topology } from './Topology';
import { TopologyAddressLink } from '../components/TopologyAddressLink';
import { recordedEndpoint, validRecordedAddress } from '../utils/topologyAddress';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const graph = { nodes: ['192.0.2.1', '192.0.2.2', '192.0.2.3', '2001:db8::1'].map(id => ({ id, label: id, zone: 'recorded', type: 'unknown', risk_score: null })), edges: [{ id: 11, source: '192.0.2.1', target: '192.0.2.2', protocol: 'modbus', port: 0, is_encrypted: false }, { id: 12, source: '192.0.2.3', target: '2001:db8::1', protocol: 'https', port: 443, is_encrypted: true }] };
function Probe() { const location=useLocation(), navigate=useNavigate(); return <><output aria-label="Current route">{location.pathname+location.search}</output><button onClick={()=>navigate('/topology?node=2001%3Adb8%3A%3A1&keep=yes')}>Change address</button><button onClick={()=>navigate(-1)}>Go back</button></>; }
function show(path: string) { render(<MemoryRouter initialEntries={[path]}><Probe /><Topology /></MemoryRouter>); }
beforeEach(()=>{ vi.resetAllMocks(); vi.mocked(apiClient.get).mockImplementation(async url => ({ data: url === '/topology/graph' ? graph : {total_connections:2,encrypted:1,unencrypted:1,by_protocol:{modbus:1,https:1}} })); });
afterEach(cleanup);
describe('Recorded event to topology handoff',()=>{
 it('opens only exact matching source or destination connections and clears without dropping unrelated parameters',async()=>{
  show('/topology?node=192.0.2.1&keep=yes'); await screen.findByRole('button',{name:'View connection 11 evidence'});
  expect(screen.queryByRole('button',{name:'View connection 12 evidence'})).toBeNull();
  expect(screen.getByText(/not physical device identity, network segment or a live traffic capture/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Clear recorded address filter'}));
  expect(await screen.findByRole('button',{name:'View connection 12 evidence'})).toBeTruthy(); expect(screen.getByLabelText('Current route').textContent).toBe('/topology?keep=yes');
 });
 it('follows IPv6 address navigation and Back without treating colons as a port',async()=>{
  show('/topology?node=192.0.2.1'); await screen.findByRole('button',{name:'View connection 11 evidence'}); fireEvent.click(screen.getByRole('button',{name:'Change address'}));
  await screen.findByRole('button',{name:'View connection 12 evidence'}); expect(screen.queryByRole('button',{name:'View connection 11 evidence'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Go back'})); expect(await screen.findByRole('button',{name:'View connection 11 evidence'})).toBeTruthy();
 });
 it('does not silently widen an unmatched address filter',async()=>{
  show('/topology?node=192.0.2.99'); await screen.findByText(/no matching node or connection/);
  expect(screen.queryByRole('button',{name:'View connection 11 evidence'})).toBeNull(); expect((screen.getByRole('button',{name:'Export filtered connections'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/does not prove the address or device has no activity/)).toBeTruthy();
 });
 it.each(['', '192.0.2.1&node=192.0.2.2','%0A192.0.2.1','%20192.0.2.1'])('rejects ambiguous or invalid address parameter %s and disables export',async value=>{
  show(`/topology?node=${value}`); await screen.findByText(/No address filter was applied and export is disabled/);
  expect((screen.getByRole('button',{name:'Export filtered connections'}) as HTMLButtonElement).disabled).toBe(true); fireEvent.click(screen.getByRole('button',{name:'Clear invalid topology link'})); expect(screen.getByLabelText('Current route').textContent).toBe('/topology');
 });
 it('encodes exact addresses in local links without selecting a physical device',()=>{
  render(<TopologyAddressLink address="2001:db8::1" side="destination" />); const link=screen.getByRole('link',{name:'Review topology matches for destination 2001:db8::1'}); expect(link.getAttribute('href')).toBe('/app/topology?node=2001%3Adb8%3A%3A1');
 });
 it.each([null,'','bad\naddress','x'.repeat(257)])('does not make navigation for absent or unreadable address %s',address=>{
  render(<TopologyAddressLink address={address} side="source" />); expect(screen.queryByRole('link')).toBeNull(); expect(validRecordedAddress(address)).toBe(false);
 });
 it('preserves port zero and brackets IPv6 when a recorded port exists',()=>{
  expect(recordedEndpoint('192.0.2.1',0)).toBe('192.0.2.1:0'); expect(recordedEndpoint('2001:db8::1',443)).toBe('[2001:db8::1]:443'); expect(recordedEndpoint('2001:db8::1',null)).toBe('2001:db8::1'); expect(recordedEndpoint(null,0)).toBe('Address not recorded, port 0');
 });
});
