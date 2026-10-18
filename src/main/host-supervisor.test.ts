import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostConnectionState, HostControl } from '../shared/rpc/desktop';
import { HostSupervisor, type HostProcess } from './host-supervisor';

class FakeHost extends EventEmitter implements HostProcess {
  postMessage = vi.fn();
  kill = vi.fn(() => true);
  ready(): void {
    this.emit('message', { type: HostControl.Ready });
  }
  crash(): void {
    this.emit('exit', 1);
  }
}

function setup() {
  const children: FakeHost[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeHost();
    children.push(child);
    return child;
  });
  const connect = vi.fn(() => true);
  const status = vi.fn();
  const supervisor = new HostSupervisor({ spawn, connect, status });
  return { children, spawn, connect, status, supervisor };
}

describe('Agent Host lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for readiness and gives every explicit renderer handshake a fresh port', () => {
    const { children, connect, supervisor } = setup();
    supervisor.start();
    supervisor.requestConnection();
    expect(connect).not.toHaveBeenCalled();
    children[0].ready();
    expect(connect).toHaveBeenCalledWith(children[0], 1);
    supervisor.requestConnection();
    children[0].ready();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenLastCalledWith(children[0], 2);
  });

  it('gives reloads and crashes a fresh port generation', () => {
    const { children, connect, status, supervisor } = setup();
    supervisor.start();
    children[0].ready();
    expect(connect).not.toHaveBeenCalled();
    supervisor.requestConnection();
    supervisor.detachRenderer();
    supervisor.requestConnection();
    expect(connect).toHaveBeenLastCalledWith(children[0], 2);
    children[0].crash();
    expect(status).toHaveBeenLastCalledWith({
      state: HostConnectionState.Restarting,
      generation: 2,
      retryInMs: 500,
    });
    vi.advanceTimersByTime(500);
    children[1].ready();
    expect(connect).toHaveBeenLastCalledWith(children[1], 3);
    children[0].ready();
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('backs off repeated failures, resetting only after sustained health', () => {
    const { children, spawn, status, supervisor } = setup();
    supervisor.start();
    children[0].crash();
    vi.advanceTimersByTime(499);
    expect(spawn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    children[1].ready();
    children[1].crash();
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ retryInMs: 1000 }));
    vi.advanceTimersByTime(1000);
    children[2].ready();
    vi.advanceTimersByTime(30_000);
    children[2].crash();
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ retryInMs: 500 }));
  });

  it('does not send a port to a detached document when a replacement host becomes ready', () => {
    const { children, connect, supervisor } = setup();
    supervisor.start();
    supervisor.requestConnection();
    supervisor.detachRenderer();
    children[0].ready();
    expect(connect).not.toHaveBeenCalled();
  });

  it('retries failed forks and kills a host that never becomes ready', () => {
    const { children, spawn, supervisor } = setup();
    spawn.mockImplementationOnce(() => {
      throw new Error('start failed');
    });
    supervisor.start();
    vi.advanceTimersByTime(500);
    expect(children).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(children[0].kill).toHaveBeenCalledOnce();
  });

  it('requests graceful shutdown and never restarts the closing child', async () => {
    const { children, spawn, supervisor } = setup();
    supervisor.start();
    children[0].ready();
    const stopping = supervisor.shutdown();
    expect(children[0].postMessage).toHaveBeenCalledWith({ type: HostControl.Shutdown });
    children[0].emit('exit', 0);
    await stopping;
    vi.advanceTimersByTime(60_000);
    expect(children[0].kill).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('bounds shutdown waiting and cancels a pending restart', async () => {
    const { children, spawn, supervisor } = setup();
    supervisor.start();
    const stopping = supervisor.shutdown();
    vi.advanceTimersByTime(5000);
    await stopping;
    expect(children[0].kill).toHaveBeenCalledOnce();
    children[0].crash();
    vi.advanceTimersByTime(60_000);
    expect(spawn).toHaveBeenCalledOnce();

    const pending = setup();
    pending.supervisor.start();
    pending.children[0].crash();
    await pending.supervisor.shutdown();
    vi.advanceTimersByTime(60_000);
    expect(pending.spawn).toHaveBeenCalledOnce();
  });
});
