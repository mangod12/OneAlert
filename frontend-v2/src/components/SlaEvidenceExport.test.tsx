import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SlaEvidenceExport } from './SlaEvidenceExport';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const props = { kind: 'cases' as const, days: 30, outcome: 'all', query: 'saved' };
const record = {id:1,title:'saved evidence',status:'closed',severity:'high',due_date:'2026-11-19',completed_on:null,outcome:'unknown',reason:'Completion time not recorded'};
const data = {format:'onealert-sla-evidence-v1',complete:true,kind:'cases',days:30,outcome:'all',query:'saved',offset:0,total:1,window_start:'2026-10-22',window_end:'2026-11-20',generated_at:'2026-11-20T12:00:00Z',scope:'Current records, not audit history',records:[record]};
beforeEach(() => { vi.resetAllMocks(); URL.createObjectURL = vi.fn(()=>'blob:export'); URL.revokeObjectURL = vi.fn(); vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}); get.mockResolvedValue({data}); });afterEach(()=>{cleanup();vi.restoreAllMocks();});
function click(){fireEvent.click(screen.getByRole('button',{name:'Download all matching SLA evidence JSON'}));}
it('downloads all matching evidence with selected filters, no page arguments, preserving unknown timing',async()=>{
  render(<SlaEvidenceExport {...props}/>);expect(get).not.toHaveBeenCalled();click();await screen.findByText(/Downloaded 1 matching/);expect(get).toHaveBeenCalledExactlyOnceWith('/reports/sla/records/export',{params:props});expect(URL.createObjectURL).toHaveBeenCalledTimes(1);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
});
it.each([{complete:false},{kind:'alerts'},{total:2},{records:[record,record],total:2},{outcome:'breached'},{query:'other'},{records:[{...record,due_date:'2025-01-01'}]}])('rejects incomplete or wrong-scope export %j',async change=>{
  get.mockResolvedValue({data:{...data,...change}});render(<SlaEvidenceExport {...props}/>);click();await screen.findByRole('alert');expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('ignores a late download after filter replacement and blocks duplicate clicks',async()=>{
  let finish!: (value:unknown)=>void;get.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const view=render(<SlaEvidenceExport key="old" {...props}/>);click();fireEvent.click(screen.getByRole('button',{name:'Preparing SLA evidence...'}));expect(get).toHaveBeenCalledTimes(1);view.rerender(<SlaEvidenceExport key="new" {...props} query="new"/>);await act(async()=>finish({data}));expect(URL.createObjectURL).not.toHaveBeenCalled();expect(screen.queryByText(/Downloaded/)).toBeNull();
});
it('shows a refusal without creating a file and allows explicit retry',async()=>{
  get.mockRejectedValueOnce(new Error('No partial export was created. Narrow search.'));render(<SlaEvidenceExport {...props}/>);click();await screen.findByRole('alert');expect(URL.createObjectURL).not.toHaveBeenCalled();click();await waitFor(()=>expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
});
