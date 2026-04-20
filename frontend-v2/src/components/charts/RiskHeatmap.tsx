import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import type { ZoneData } from '../../api/types';
import clsx from 'clsx';

export function RiskHeatmap() {
  const [zones, setZones] = useState<ZoneData[]>([]);

  useEffect(() => {
    apiClient.get('/ot/devices-by-zone').then((res) => {
      setZones(res.data.zones || []);
    }).catch(() => {});
  }, []);

  const purdueZones = [
    { level: 5, label: 'Enterprise', description: 'Internet/DMZ' },
    { level: 4, label: 'Business', description: 'ERP, Email' },
    { level: 3, label: 'Operations', description: 'Historians, SCADA servers' },
    { level: 2, label: 'Control', description: 'HMI, Engineering workstations' },
    { level: 1, label: 'Basic Control', description: 'PLCs, RTUs, DCS' },
    { level: 0, label: 'Process', description: 'Sensors, Actuators' },
  ];

  const getZoneCount = (level: number) => {
    const zone = zones.find((z) => z.zone === `level_${level}` || z.zone === String(level));
    return zone?.count ?? 0;
  };

  const getColor = (count: number) => {
    if (count === 0) return 'bg-surface-700/50 border-surface-600';
    if (count <= 2) return 'bg-success/10 border-success/30';
    if (count <= 5) return 'bg-warning/10 border-warning/30';
    return 'bg-danger/10 border-danger/30';
  };

  return (
    <div className="space-y-2">
      {purdueZones.map((zone) => {
        const count = getZoneCount(zone.level);
        return (
          <div
            key={zone.level}
            className={clsx(
              'flex items-center justify-between p-3 rounded-lg border',
              getColor(count)
            )}
          >
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono text-surface-400 w-8">L{zone.level}</span>
              <div>
                <p className="text-sm font-medium text-white">{zone.label}</p>
                <p className="text-xs text-surface-500">{zone.description}</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-surface-300">{count} devices</span>
          </div>
        );
      })}
      {zones.length === 0 && (
        <p className="text-center text-surface-500 py-4 text-sm">
          No OT zone data available. Add assets with network zones to see the heatmap.
        </p>
      )}
    </div>
  );
}
