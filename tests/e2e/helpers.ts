import { cp, mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, Request } from '@playwright/test';
import { serveStatic } from '../../scripts/static-server';

export interface Host {
  url: string;
  root: string;
  requests: string[];
  close(): Promise<void>;
  watch(page: Page): void;
}

/** Copies a bundle to a fresh folder outside the repository and serves it at a nested path. */
export async function hostBundle(bundle: string, port: number, base = 'projects/reel'): Promise<Host> {
  const root = await mkdtemp(join(tmpdir(), 'reel-host-'));
  await cp(bundle, join(root, base), { recursive: true });
  const server: Server = await serveStatic(root, port);
  const requests: string[] = [];
  return {
    url: `http://127.0.0.1:${port}/${base}/`,
    root,
    requests,
    watch(page) {
      page.on('request', (request: Request) => requests.push(request.url()));
    },
    async close() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Waits until the story has reached `t` and has committed the state. */
export async function seekTo(page: Page, seconds: number) {
  const slider = page.getByRole('slider', { name: 'Story position' });
  await slider.fill(String(seconds * 1000));
}

/** Starts a new project and waits for the workspace. */
export async function newProject(page: Page, scene: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${scene}`) }).click();
  await page.getByRole('button', { name: 'Record' }).waitFor();
}
