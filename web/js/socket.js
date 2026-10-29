// Client WebSocket /live avec reconnexion auto (F-17 : 30 s côté serveur).
export const live = {
  ws: null, handler: null,
  connect({ onMsg }) {
    this.handler = onMsg;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live';
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'ping') { this.ws.send(JSON.stringify({ t: 'pong', at: m.at })); return; }
      onMsg(m);
    };
    this.ws.onclose = () => setTimeout(() => this.connect({ onMsg }), 2000);
    return this.ws;
  },
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); },
};
