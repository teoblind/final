/**
 * Sandbox Service — Execute code in isolated Docker containers
 *
 * Runs user code (Python, JavaScript, bash) in a sandboxed Docker container
 * with no network access, memory limits, and a strict timeout.
 */

import { execFile } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const SANDBOX_BASE = process.env.SANDBOX_DIR || '/data/sandbox';
const DOCKER_IMAGE = 'coppice-sandbox';
const DEFAULT_TIMEOUT = 30000; // 30s

export async function executeCode(tenantId, language, code, timeoutMs = DEFAULT_TIMEOUT) {
  // Sanitize tenantId to prevent path traversal
  const safeTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Create per-tenant workspace directory
  const workspaceDir = path.join(SANDBOX_BASE, safeTenantId);
  await mkdir(workspaceDir, { recursive: true });

  // Write code to a temp file
  const ext = { python: 'py', javascript: 'js', bash: 'sh' }[language];
  const filename = `run_${randomUUID().slice(0, 8)}.${ext}`;
  const codePath = path.join(workspaceDir, filename);
  await writeFile(codePath, code);

  // Build docker run command
  const cmd = { python: 'python3', javascript: 'node', bash: 'bash' }[language];
  const args = [
    'run', '--rm',
    '--network=none',
    '--memory=256m',
    '--cpus=0.5',
    '--pids-limit=64',
    '--read-only',
    '--tmpfs', '/tmp:size=50m',
    '-v', `${workspaceDir}:/workspace:rw`,
    '-w', '/workspace',
    DOCKER_IMAGE,
    cmd, `/workspace/${filename}`,
  ];

  const startTime = Date.now();

  return new Promise((resolve) => {
    const proc = execFile('docker', args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB output limit
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;

      if (error && error.killed) {
        resolve({ stdout: stdout || '', stderr: 'Execution timed out', exitCode: 124, durationMs });
      } else {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? error.code || 1 : 0,
          durationMs,
        });
      }
    });
  });
}
