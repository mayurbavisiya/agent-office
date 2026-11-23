// Sandboxed preload: exposes exactly two calls to the page. No Node, no raw ipcRenderer.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentOfficeShell', {
  expandRoom: (sessionId: string): void => {
    if (typeof sessionId === 'string') ipcRenderer.send('ao:expand-room', sessionId);
  },
  hide: (): void => ipcRenderer.send('ao:hide'),
});
