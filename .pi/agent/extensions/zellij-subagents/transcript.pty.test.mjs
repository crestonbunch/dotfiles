import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { startTranscript } from './transcript.mjs';

const python = String.raw`
import os, sys, json, pty, fcntl, termios, struct, subprocess, tempfile, threading, time, socket

args = json.loads(sys.argv[1])
# Exercise the real navigation bindings without needing a child session or Pi.
with tempfile.TemporaryDirectory(prefix='pi-fzf-test-') as tmp:
    sock = tmp + '/fzf.sock'
    preview_count = tmp + '/previews'
    labels = tmp + '/labels'
    args[args.index('--preview') + 1] = 'printf x >> ' + preview_count + '; seq 1 100'
    args += ['--listen=' + sock, '--bind', 'ctrl-t:execute-silent(printf "%s\\n%s\\n%s" "$FZF_PREVIEW_LABEL" "$FZF_LIST_LABEL" "$FZF_PROMPT" > ' + labels + ')']
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    def setup():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    env = dict(os.environ, TERM='xterm-256color', FZF_DEFAULT_OPTS='', FZF_DEFAULT_OPTS_FILE='')
    child = subprocess.Popen(['fzf'] + args, stdin=subprocess.PIPE, stdout=slave, stderr=slave, env=env, preexec_fn=setup)
    os.close(slave)
    output = bytearray()
    def drain():
        try:
            while True: output.extend(os.read(master, 65536))
        except OSError: pass
    threading.Thread(target=drain, daemon=True).start()
    def state():
        conn = socket.socket(socket.AF_UNIX)
        try:
            conn.settimeout(1)
            conn.connect(sock)
            conn.sendall(b'GET / HTTP/1.0\r\n\r\n')
            data = bytearray()
            while True:
                chunk = conn.recv(65536)
                if not chunk: break
                data.extend(chunk)
            return json.loads(data.split(b'\r\n\r\n', 1)[1])
        finally: conn.close()
    def wait_for(predicate):
        deadline = time.monotonic() + 5
        last = None
        while time.monotonic() < deadline:
            if child.poll() is not None: raise AssertionError(output.decode(errors='replace'))
            try:
                last = state()
                if predicate(last): return last
            except (OSError, ValueError, IndexError): pass
            time.sleep(.03)
        raise AssertionError('Timed out: ' + repr(last) + '\n' + output.decode(errors='replace')[-2000:])
    def current(s): return (s.get('current') or {}).get('text', '')
    def send(keys): os.write(master, keys)
    def snapshot_labels(expected):
        deadline = time.monotonic() + 3
        value = ''
        while time.monotonic() < deadline:
            send(b'\x14')
            time.sleep(.03)
            if os.path.exists(labels):
                with open(labels) as f: value = f.read()
                if value.endswith('> ') and expected in value: return value
        raise AssertionError('Expected label ' + repr(expected) + ', got ' + repr(value))
    def rows(start, end):
        child.stdin.write(''.join(str(n) + ':0\tevent ' + str(n) + '\n' for n in range(start, end)).encode())
        child.stdin.flush()
    try:
        rows(1, 6)
        wait_for(lambda s: s.get('totalCount') == 5 and current(s))
        send(b'\x1b[H')
        wait_for(lambda s: current(s).startswith('5:0'))
        send(b'j')
        wait_for(lambda s: current(s).startswith('4:0'))
        send(b'\x0a\x0a\x0a')
        time.sleep(.15)
        with open(preview_count) as f: before = f.read()
        rows(6, 10)
        held = wait_for(lambda s: s.get('totalCount') == 9)
        assert current(held).startswith('4:0'), held
        assert 'Reading · 5 newer events' in snapshot_labels('Reading · 5 newer events')
        with open(preview_count) as f: assert f.read() == before, 'Selected preview restarted on append'
        send(b'f')
        wait_for(lambda s: current(s).startswith('9:0'))
        send(b'\x0a')
        assert 'Reading · 0 newer events' in snapshot_labels('Reading · 0 newer events')
        rows(10, 11)
        wait_for(lambda s: s.get('totalCount') == 10 and current(s).startswith('9:0'))
        send(b'f')
        wait_for(lambda s: current(s).startswith('10:0'))
        send(b'j')
        wait_for(lambda s: current(s).startswith('9:0'))
        rows(11, 12)
        wait_for(lambda s: s.get('totalCount') == 11 and current(s).startswith('9:0'))
        send(b'/event 4')
        wait_for(lambda s: s.get('matchCount') == 1 and current(s).startswith('4:0'))
        send(b'\x07')
        wait_for(lambda s: s.get('matchCount') == 11)
        send(b'r')
        assert snapshot_labels('Raw\n').startswith('Raw\n')
        send(b'rwp')
        assert snapshot_labels('Rendered\n').startswith('Rendered\n')
        assert child.poll() is None, output.decode(errors='replace')
        print('PASS live selection, preview stability, follow, search and rendering controls')
    finally:
        child.terminate()
        child.wait(timeout=5)
        os.close(master)
`;

test('live fzf keeps the selected event while streaming and follows only on request', { timeout: 20000 }, t => {
  if (spawnSync('python3', ['--version']).status !== 0 || spawnSync('fzf', ['--version']).status !== 0) {
    t.skip('requires python3 and fzf');
    return;
  }
  let args;
  const feed = startTranscript('/unused', { spawnProcess(command, values) {
    if (command === 'fzf') args = values;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = () => { child.killed = true; };
    return child;
  } });
  feed.stop();
  const result = spawnSync('python3', ['-c', python, JSON.stringify(args)], { encoding: 'utf8', timeout: 18000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /PASS live selection/);
});
