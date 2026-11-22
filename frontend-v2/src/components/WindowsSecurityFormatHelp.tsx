export function WindowsSecurityFormatHelp() {
  const example = { '@timestamp': '2026-01-01T00:00:00Z', winlog: { channel: 'Security', event_id: '4625', computer_name: 'example-host', event_data: { TargetUserName: 'example-account', TargetDomainName: 'EXAMPLE', IpAddress: '192.0.2.4', IpPort: '0' } } };
  return <section aria-label="Windows Security JSON format" className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
    <h3 className="font-medium text-surface-100">Windows Security-channel JSON</h3>
    <p>Choose Winlogbeat-shaped JSON records with a nested winlog object, channel Security and an unsigned decimal event_id. JSON object, array or NDJSON only, not binary EVTX or XML. No collector is installed or contacted.</p>
    <p>Time uses winlog.time_created when present, otherwise @timestamp. Both require a timezone. Invalid present creation time is rejected, not replaced by collector time or the current clock. These times are producer-reported, not independently verified.</p>
    <p>Host comes only from winlog.computer_name, not the forwarding agent. Account/domain come only from TargetUserName/TargetDomainName; client address/port come only from IpAddress/IpPort in winlog.event_data. Missing, empty or dash values remain absent. No subject-account or agent-host substitution.</p>
    <p className="text-warning">Imported records are informational Windows Security events, not detection matches, confirmed attacks, authentication verdicts or response actions. The shared raw-payload redaction policy still applies; normalized account, host and endpoint fields remain security evidence.</p>
    <details><summary className="cursor-pointer text-primary-300">Show synthetic JSON format example</summary><p className="my-2">Format example only, not observed evidence. Replace it with your own source records before import.</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-950 p-2 text-surface-200">{JSON.stringify(example, null, 2)}</pre></details>
  </section>;
}
