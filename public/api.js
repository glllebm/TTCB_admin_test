// api.js — заменяет localStorage, работает с сервером
// Подключается во все HTML-страницы как <script src="api.js"></script>

const API = {
  base: "",  // тот же сервер

  // opts.ungated=true → admin's own view; keeps trend arrows past the 7-day
  // window. Omit it (default) for public-equivalent, gated responses.
  async getPlayers(opts = {}) {
    const q = opts.ungated ? "?ungated=1" : "";
    const r = await fetch(this.base + "/api/players" + q);
    return r.json();
  },
  async getPlayer(id, opts = {}) {
    const q = opts.ungated ? "?ungated=1" : "";
    const r = await fetch(this.base + "/api/players/" + encodeURIComponent(id) + q);
    if (!r.ok) return null;
    return r.json();
  },
  async savePlayer(player) {
    if (player.id) {
      const r = await fetch(this.base + "/api/players/" + encodeURIComponent(player.id), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(player)
      });
      return r.json();
    } else {
      const r = await fetch(this.base + "/api/players", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(player)
      });
      return r.json();
    }
  },
  async deletePlayer(id) {
    await fetch(this.base + "/api/players/" + encodeURIComponent(id), { method: "DELETE" });
  },
  // Apply many player updates in one atomic request (tournament finish) so the
  // rank-delta baseline is diffed once for the whole field.
  async batchUpdatePlayers(players) {
    const r = await fetch(this.base + "/api/players/batch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ players })
    });
    return r.json();
  },

  async getTournaments() {
    const r = await fetch(this.base + "/api/tournaments");
    return r.json();
  },
  async saveTournament(t) {
    if (t.id) {
      // check if exists first
      const check = await fetch(this.base + "/api/tournaments/" + encodeURIComponent(t.id));
      if (check.ok) {
        const r = await fetch(this.base + "/api/tournaments/" + encodeURIComponent(t.id), {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t)
        });
        return r.json();
      }
    }
    const r = await fetch(this.base + "/api/tournaments", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t)
    });
    return r.json();
  },

  async getTournamentState(id) {
    const r = await fetch(this.base + "/api/tournament-state/" + encodeURIComponent(id));
    if (!r.ok) return {};
    return r.json();
  },
  async saveTournamentState(id, state) {
    await fetch(this.base + "/api/tournament-state/" + encodeURIComponent(id), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state)
    });
  },

  // Current tournament id — в sessionStorage (не нужен сервер)
  getCurrentId() { return sessionStorage.getItem("tm_current_id") || null; },
  setCurrentId(id) { sessionStorage.setItem("tm_current_id", id); },
};
