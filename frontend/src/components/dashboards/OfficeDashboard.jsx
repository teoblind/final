/**
 * OfficeDashboard — Embeds OpenClaw Office (mock mode)
 *
 * Full-screen iframe to the OpenClaw Office visual agent simulation
 * running on the same origin via Nginx proxy.
 */

import React from 'react';

export default function OfficeDashboard() {
  // Served from /openclaw-office/ path on the same domain via Nginx proxy
  const officeUrl = '/openclaw-office/';

  return (
    <div className="w-full h-screen -mt-[1px]">
      <iframe
        src={officeUrl}
        className="w-full h-full border-0"
        title="Coppice Office"
        allow="fullscreen"
      />
    </div>
  );
}
