export function DeviceRecordLink({ deviceId }: { deviceId: number | null | undefined }) {
  if (!Number.isSafeInteger(deviceId) || deviceId == null || deviceId < 1) return null;
  return <a href={`/app/ot?device=${deviceId}`} className="inline-block rounded border border-surface-600 px-2 py-1.5 text-xs text-primary-300 hover:text-primary-200">Open inventory record #{deviceId}</a>;
}
