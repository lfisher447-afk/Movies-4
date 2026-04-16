'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   BINGEBOX OMEGA — ULTIMATE ENGINE v3.0
   Full-stack streaming platform core — every system maxed out.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── OMEGA SHIELD v3 — Neural-Grade Multi-Layer Ad & Threat Blocker ──────── */
const OmegaShield = (() => {
   const BLOCKED_DOMAINS = [
      'popads.net','adsterra.com','exoclick.com','propellerads.com','bet365.com','1xbet.com',
      'adcash.com','onclickalgo.com','doubleclick.net','google-analytics.com','mgid.com',
      'trafficjunky.net','juicyads.com','hilltopads.net','clickadu.com','popcash.net',
      'adnxs.com','rubiconproject.com','pubmatic.com','openx.net','appnexus.com',
      'outbrain.com','taboola.com','revcontent.com','adsafeprotected.com','moatads.com',
      'amazon-adsystem.com','scorecardresearch.com','omtrdc.net','bluekai.com','krxd.net',
      'xtendmedia.com','casalemedia.com','smartadserver.com','yieldmo.com','undertone.com',
      'advertising.com','yieldoptimizer.com','servedby.flashtalking.com','ads.twitter.com',
      'ads.linkedin.com','connect.facebook.net','platform.twitter.com','widgets.outbrain.com',
      'cdn.taboola.com','engine.carbonads.com','srv.carbonads.com','adblade.com',
      'traffichunt.com','trafmag.com','popin.cc','ozip.io','pushcrew.com',
      'onesignal.com','web-push-notifications.com','trackjs.com','trackadblock.com',
      'cdn.confiant-integrations.net','cdn.bootlicker.io','trustarc.com',
   ];
   const BLOCKED_RE = /\b(popup|popunder|overlay|interstitial|takeover|adhesion|leaderboard|advert|advertisement|adsense|adservice|adsystem|gpt\.js|show_ads|banner_ads|rich-media|sponsor(?:ed)?[-_](?:content|post|link)|exit.?intent|push.?notif|cookie.?consent.?banner)\b/i;
   const AD_SIG_RE  = /\b(popup|overlay|banner|sponsor|ad-container|ad-banner|ads-wrapper|ad-unit|advert|adsbox|ad-slot|gpt-ad|dfp-ad|affiliate|sponsored|tracking)\b/i;

   /* Block by domain match */
   function isDomainBlocked(url) {
      try { const h = new URL(String(url)).hostname.replace(/^www\./, ''); return BLOCKED_DOMAINS.some(d => h === d || h.endsWith('.' + d)); }
      catch (_) { return BLOCKED_DOMAINS.some(d => String(url).includes(d)); }
   }

   /* Detect ad/overlay nodes by signature, z-index, positioning */
   function isAdNode(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.id?.includes('bingebox') || node.id?.includes('bb-')) return false;
      const sig = ((node.id || '') + ' ' + (node.className || '')).toLowerCase();
      const src = node.src || node.href || node.action || '';
      if (isDomainBlocked(src)) return true;
      if (AD_SIG_RE.test(sig)) return true;
      const cs = window.getComputedStyle?.(node);
      if (cs) {
         const z = parseInt(cs.zIndex || 0);
         const pos = cs.position;
         const inert = node.tagName === 'SCRIPT' || node.tagName === 'STYLE';
         if (!inert && z > 99999 && (pos === 'fixed' || pos === 'absolute')) return true;
      }
      return false;
   }

   /* Patch fetch */
   function patchFetch() {
      const _orig = window.fetch;
      window.fetch = function (...args) {
         if (isDomainBlocked(String(args[0] || ''))) {
            console.debug('[OmegaShield] Blocked fetch:', args[0]);
            return Promise.resolve(new Response(null, { status: 204 }));
         }
         return _orig.apply(this, args);
      };
   }

   /* Patch XHR */
   function patchXHR() {
      const _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u, ...r) {
         if (isDomainBlocked(String(u || ''))) {
            console.debug('[OmegaShield] Blocked XHR:', u);
            return _open.call(this, m, 'about:blank', ...r);
         }
         return _open.call(this, m, u, ...r);
      };
   }

   /* Patch window.open */
   function patchWindowOpen() {
      const _orig = window.open;
      window.open = function (url, name, features) {
         if (!url) return null;
         if (isDomainBlocked(url) || BLOCKED_RE.test(url)) {
            console.debug('[OmegaShield] Blocked window.open:', url);
            return null;
         }
         if (name && name !== '_blank' && name !== '_self' && name !== '_parent') return null;
         return _orig.call(window, url, name, features);
      };
   }

   /* Patch document.write (common ad injection vector) */
   function patchDocWrite() {
      const _write = document.write.bind(document);
      document.write = function (markup) {
         if (typeof markup === 'string' && BLOCKED_RE.test(markup)) {
            console.debug('[OmegaShield] Blocked document.write');
            return;
         }
         return _write(markup);
      };
   }

   /* MutationObserver — remove ad nodes as they're inserted */
   function startObserver() {
      const obs = new MutationObserver(mutations => {
         for (const mut of mutations) {
            for (const node of mut.addedNodes) {
               if (isAdNode(node)) {
                  try { node.style.display = 'none'; node.remove(); } catch (_) {}
               }
            }
         }
      });
      const attach = () => {
         if (document.body) obs.observe(document.body, { childList: true, subtree: true });
      };
      document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', attach) : attach();
   }

   /* Watch for dynamically inserted iframes pointing to ad networks */
   function watchIframes() {
      const iObs = new MutationObserver(muts => {
         for (const m of muts) {
            for (const n of m.addedNodes) {
               if (n.tagName === 'IFRAME' && isDomainBlocked(n.src || n.dataset.src || '')) {
                  n.remove();
               }
            }
         }
      });
      const attach = () => {
         if (document.documentElement) iObs.observe(document.documentElement, { childList: true, subtree: true });
      };
      document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', attach) : attach();
   }

   function init() {
      patchFetch();
      patchXHR();
      patchWindowOpen();
      patchDocWrite();
      startObserver();
      watchIframes();
   }

   return { init, isDomainBlocked };
})();
OmegaShield.init();


/* ── EVENT BUS — Pub/Sub for decoupled communication ─────────────────────── */
const EventBus = (() => {
   const listeners = new Map();
   return {
      on(event, fn, { once = false } = {}) {
         if (!listeners.has(event)) listeners.set(event, []);
         listeners.get(event).push({ fn, once });
         return () => this.off(event, fn);
      },
      once(event, fn) { return this.on(event, fn, { once: true }); },
      off(event, fn) {
         if (!listeners.has(event)) return;
         listeners.set(event, listeners.get(event).filter(l => l.fn !== fn));
      },
      emit(event, data) {
         const evtListeners = listeners.get(event) || [];
         const wildcard = listeners.get('*') || [];
         [...evtListeners, ...wildcard].forEach(({ fn, once }) => {
            try { fn(data, event); } catch (e) { console.error(`EventBus error on "${event}":`, e); }
         });
         listeners.set(event, evtListeners.filter(l => !l.once));
      }
   };
})();


/* ── SAFE STORAGE v2 — Versioned, fault-tolerant, compressed ──────────────── */
const SafeStorage = {
   _v: '3.0',
   get(k, fallback = null) {
      try {
         const raw = localStorage.getItem(k);
         if (!raw) return fallback;
         const parsed = JSON.parse(raw);
         return parsed;
      } catch { return fallback; }
   },
   set(k, v) {
      try {
         localStorage.setItem(k, JSON.stringify(v));
         return true;
      } catch (e) {
         if (e.name === 'QuotaExceededError') {
            console.warn('[SafeStorage] Quota exceeded, pruning old data…');
            this._prune();
            try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
         }
         return false;
      }
   },
   remove(k) { try { localStorage.removeItem(k); } catch (_) {} },
   _prune() {
      /* Remove oldest watch history entries to free space */
      const hist = this.get('bb_history', []);
      if (hist.length > 20) this.set('bb_history', hist.slice(0, 20));
      const cache_keys = ['bb_tmdb_cache'];
      cache_keys.forEach(k => this.remove(k));
   },
   export() {
      const d = {
         version: this._v,
         exportedAt: new Date().toISOString(),
         lib: AppState.library,
         set: AppState.settings,
         stats: AppState.stats,
         profiles: AppState.profiles,
         wishlist: State.get('wishlist'),
         history: State.get('watchHistory'),
         achievements: AppState.achievements,
      };
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `BingeBox_Omega_Backup_${Date.now()}.json` });
      a.click(); URL.revokeObjectURL(a.href);
      showToast('Backup exported successfully!', 'success');
   },
   import(file) {
      return new Promise((resolve, reject) => {
         const r = new FileReader();
         r.onload = e => {
            try {
               const d = JSON.parse(e.target.result);
               if (d.lib) this.set('bb_lib', d.lib);
               if (d.set) this.set('bb_settings', d.set);
               if (d.stats) this.set('bb_stats', d.stats);
               if (d.wishlist) this.set('bb_wishlist', d.wishlist);
               if (d.history) this.set('bb_history', d.history);
               if (d.achievements) this.set('bb_achievements', d.achievements);
               showToast('Backup restored! Reloading…', 'success');
               setTimeout(() => location.reload(), 1500);
               resolve();
            } catch (err) { showToast('Invalid backup file.', 'error'); reject(err); }
         };
         r.onerror = reject;
         r.readAsText(file);
      });
   }
};

/* ── CONFIG ────────────────────────────────────────────────────────────────── */
const CONFIG = {
   TMDB_BASE: '/api/v1/tmdb', // Points to the server.js proxy
   IMG_BASE: 'https://image.tmdb.org/t/p',
   IMG_W500: 'https://image.tmdb.org/t/p/w500',
   IMG_W1280: 'https://image.tmdb.org/t/p/w1280',
   IMG_ORIG: 'https://image.tmdb.org/t/p/original',
   CACHE_TTL: 5 * 60 * 1000,        
   CACHE_TTL_LONG: 60 * 60 * 1000,  
   MAX_CONCURRENT: 6,
   MAX_RETRIES: 3,
};

/* ── TMDB API v2 — Dedup, TTL cache, retry, request queue ──────────────────── */
const TMDB = (() => {
   const cache = AppState.cache;
   const inflight = AppState.inflightRequests;

   async function _raw(url, retries = CONFIG.MAX_RETRIES) {
      for (let attempt = 0; attempt < retries; attempt++) {
         try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (res.status === 429) {
               const retry = parseInt(res.headers.get('Retry-After') || 2);
               await new Promise(r => setTimeout(r, retry * 1000 * (attempt + 1)));
               continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
         } catch (err) {
            if (attempt === retries - 1) throw err;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
         }
      }
   }

   return {
      async fetch(path, params = {}, ttl = CONFIG.CACHE_TTL) {
         // Appends language param without the raw API key
         const q = new URLSearchParams({ language: AppState.settings.language || 'en-US', ...params }).toString();
         const cleanPath = '/' + path.replace(/^\/+/, '');
         const url = `${CONFIG.TMDB_BASE}${cleanPath}?${q}`;

         if (cache.has(url)) {
            const entry = cache.get(url);
            if (Date.now() - entry.ts < ttl) return entry.data;
            cache.delete(url);
         }

         if (inflight.has(url)) return inflight.get(url);

         const req = _raw(url)
            .then(data => {
               if (data) cache.set(url, { data, ts: Date.now() });
               inflight.delete(url);
               return data;
            })
            .catch(err => {
               inflight.delete(url);
               console.warn(`[TMDB] Failed: ${path}`, err.message);
               return null;
            });

         inflight.set(url, req);
         return req;
      },

      async fetchMulti(paths, params = {}) {
         return Promise.all(paths.map(p => this.fetch(p, params)));
      },

      clearCache() { cache.clear(); },
   };
})();


/* ── APP STATE ─────────────────────────────────────────────────────────────── */
const AppState = {
   profiles: SafeStorage.get('bb_profiles', [
      { id: 'p1', name: 'Admin', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin&backgroundColor=b6e3f4', pin: null, settings: {} },
      { id: 'p2', name: 'Guest', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Guest&backgroundColor=ffd5dc', pin: null, settings: {} }
   ]),
   currentProfile: null,
   settings: SafeStorage.get('bb_settings', {
      theme: 'netflix', defaultServer: 'vidlink', ambientGlow: true, cinemaDim: true,
      bandwidthSaver: false, hapticIntensity: 50, privacyMode: false,
      autoPlayNext: true, showCastSection: true, language: 'en-US',
      subtitleLang: 'off', qualityPref: 'auto', reducedMotion: false,
      notificationsEnabled: true, autoTheme: false,
   }),
   library: SafeStorage.get('bb_lib', { history: [], liked: [], watchlater: [] }),
   stats: SafeStorage.get('bb_stats', {
      hoursWatched: 0, movies: 0, episodes: 0, lastWatchDate: null,
      streak: 0, longestStreak: 0, topGenres: {}, weeklyActivity: Array(7).fill(0),
   }),
   achievements: SafeStorage.get('bb_achievements', {}),
   cache: new Map(),
   inflightRequests: new Map(),
   requestQueue: [],
   activeRequests: 0,
   konamiIndex: 0,
   konamiCode: ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'],
   recentSearches: SafeStorage.get('bb_recent_searches', []),
};

/* ── REACTIVE STATE ────────────────────────────────────────────────────────── */
const State = (() => {
   let _s = {
      currentId: null, currentType: null, currentSeason: 1, currentEpisode: 1,
      currentServer: 0, searchQuery: '', searchPage: 1, filterPage: 1,
      currentCategory: '', currentCategoryType: 'movie', currentGenreId: null,
      heroItems: [], heroIndex: 0,
      wishlist: SafeStorage.get('bb_wishlist', []),
      watchHistory: SafeStorage.get('bb_history', []),
      infiniteScrollOn: false, isFetchingMore: false,
      searchOpen: false, notifPanelOpen: false,
      episodeProgress: SafeStorage.get('bb_ep_progress', {}),
      continueWatching: SafeStorage.get('bb_continue', []),
   };
   return {
      get(k) { return _s[k]; },
      set(k, v) {
         const prev = _s[k]; _s[k] = v;
         if (prev !== v) EventBus.emit(`state:${k}`, { prev, next: v });
      },
      toggle(k) { const v = !_s[k]; this.set(k, v); return v; },
      persist() {
         SafeStorage.set('bb_wishlist', _s.wishlist);
         SafeStorage.set('bb_history', _s.watchHistory);
         SafeStorage.set('bb_ep_progress', _s.episodeProgress);
         SafeStorage.set('bb_continue', _s.continueWatching);
      },
      snapshot() { return { ..._s }; },
   };
})();


/* ── SERVERS — with health status tracking ─────────────────────────────────── */
const SERVERS = [
   { id: 'vidlink',    name: 'VidLink Pro',       badge: '⚡',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://vidlink.pro/movie/${id}?primaryColor=E50914&autoplay=true`:`https://vidlink.pro/tv/${id}/${s}/${e}?primaryColor=E50914&autoplay=true` },
   { id: 'vidsrcpro',  name: 'VidSrc PRO',        badge: '🔥',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://vidsrc.pro/embed/movie/${id}`:`https://vidsrc.pro/embed/tv/${id}/${s}/${e}` },
   { id: 'videasy',    name: 'Videasy',            badge: '🎬',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://player.videasy.net/movie/${id}`:`https://player.videasy.net/tv/${id}/${s}/${e}` },
   { id: 'vidsrccc',   name: 'VidSrc CC',          badge: '🌐',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://vidsrc.cc/v2/embed/movie/${id}`:`https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}` },
   { id: 'superembed', name: 'SuperEmbed HD',      badge: '🔮',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://multiembed.mov/directstream.php?video_id=${id}`:`https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
   { id: 'autoembed',  name: 'AutoEmbed',          badge: '🤖',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://player.autoembed.cc/embed/movie/${id}`:`https://player.autoembed.cc/embed/tv/${id}/${s}/${e}` },
   { id: '2embed',     name: '2Embed',             badge: '✨',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://www.2embed.cc/embed/${id}`:`https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
   { id: 'vidsrcme',   name: 'VidSrc.ME',          badge: '💾',  status: 'ok',
     build: (t,id,s,e) => t==='movie'?`https://vidsrc.me/embed/movie?tmdb=${id}`:`https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
];

/* ── CONTENT ROW DEFINITIONS ───────────────────────────────────────────────── */
const ROWS = [
   { id: 'trending',    title: '🔥 Trending Now',              ep: '/trending/all/week',                              mt: 'all',   badge: 'top10' },
   { id: 'continue',    title: '▶️ Continue Watching',          ep: null,                                              mt: 'mixed', badge: 'progress', special: 'continue' },
   { id: 'popular-m',   title: '🎬 Popular Movies',             ep: '/movie/popular',                                  mt: 'movie' },
   { id: 'now-play',    title: '🎭 Now In Theaters',            ep: '/movie/now_playing',                              mt: 'movie', badge: 'new' },
   { id: 'top-m',       title: '🏆 Top Rated Movies',           ep: '/movie/top_rated',                                mt: 'movie' },
   { id: 'top-t',       title: '📺 Top Rated TV Shows',         ep: '/tv/top_rated',                                   mt: 'tv' },
   { id: 'popular-tv',  title: '🌟 Popular TV Shows',           ep: '/tv/popular',                                     mt: 'tv' },
   { id: 'airing',      title: '📡 Airing Today',               ep: '/tv/airing_today',                                mt: 'tv',    badge: 'live' },
   { id: 'action',      title: '💥 Action & Adventure',         ep: '/discover/movie?with_genres=28&sort_by=popularity.desc', mt: 'movie' },
   { id: 'comedy',      title: '😂 Comedies',                   ep: '/discover/movie?with_genres=35&sort_by=popularity.desc', mt: 'movie' },
   { id: 'horror',      title: '👻 Horror',                     ep: '/discover/movie?with_genres=27&sort_by=popularity.desc', mt: 'movie' },
   { id: 'scifi',       title: '🚀 Sci-Fi & Fantasy',           ep: '/discover/movie?with_genres=878&sort_by=popularity.desc', mt: 'movie' },
   { id: 'thriller',    title: '🔪 Thrillers',                  ep: '/discover/movie?with_genres=53&sort_by=popularity.desc', mt: 'movie' },
   { id: 'romance',     title: '💕 Romance',                    ep: '/discover/movie?with_genres=10749&sort_by=popularity.desc', mt: 'movie' },
   { id: 'documentary', title: '🎙️ Documentaries',              ep: '/discover/movie?with_genres=99&sort_by=popularity.desc', mt: 'movie' },
   { id: 'anime-tv',    title: '⛩️ Anime Series',               ep: '/discover/tv?with_genres=16&sort_by=popularity.desc', mt: 'tv' },
   { id: 'crime-tv',    title: '🕵️ Crime & Mystery TV',         ep: '/discover/tv?with_genres=80&sort_by=popularity.desc', mt: 'tv' },
   { id: 'upcoming',    title: '🗓️ Coming Soon',                ep: '/movie/upcoming',                                 mt: 'movie', badge: 'soon' },
   { id: 'hidden-gems', title: '💎 Hidden Gems',                ep: '/discover/movie?vote_average.gte=7.5&vote_count.gte=1000&sort_by=vote_average.desc', mt: 'movie' },
   { id: 'classic',     title: '🎞️ Classic Cinema',             ep: '/discover/movie?primary_release_date.lte=1990-01-01&sort_by=vote_average.desc&vote_count.gte=5000', mt: 'movie' },
];

const GENRE_MAP = {};

/* ── ACHIEVEMENTS REGISTRY ─────────────────────────────────────────────────── */
const ACHIEVEMENTS_DEF = [
   { id: 'first_watch',    name: 'First Watch',       desc: 'Watch your first title',               icon: '🎬', rarity: 'common',    req: s => s.movies + s.episodes >= 1 },
   { id: 'binge_starter',  name: 'Binge Starter',     desc: 'Watch 5 episodes in a row',            icon: '📺', rarity: 'common',    req: s => s.episodes >= 5 },
   { id: 'movie_buff',     name: 'Movie Buff',         desc: 'Watch 10 movies',                      icon: '🍿', rarity: 'uncommon',  req: s => s.movies >= 10 },
   { id: 'night_owl',      name: 'Night Owl',          desc: 'Watch something after midnight',       icon: '🦉', rarity: 'uncommon',  req: () => new Date().getHours() >= 0 && new Date().getHours() < 4 },
   { id: 'explorer',       name: 'Explorer',           desc: 'Browse 5 different genres',            icon: '🗺️', rarity: 'uncommon',  req: s => Object.keys(s.topGenres || {}).length >= 5 },
   { id: 'collector',      name: 'Collector',          desc: 'Add 20 titles to My List',             icon: '📚', rarity: 'uncommon',  req: (_, wl) => wl.length >= 20 },
   { id: 'marathon',       name: 'Marathon Runner',    desc: 'Watch 50 episodes',                    icon: '🏃', rarity: 'rare',      req: s => s.episodes >= 50 },
   { id: 'cinephile',      name: 'Cinephile',          desc: 'Watch 25 movies',                      icon: '🎭', rarity: 'rare',      req: s => s.movies >= 25 },
   { id: 'streak_3',       name: 'Hat Trick',          desc: 'Watch 3 days in a row',                icon: '🎩', rarity: 'rare',      req: s => s.streak >= 3 },
   { id: 'streak_7',       name: 'Week Warrior',       desc: '7-day watch streak',                   icon: '⚔️', rarity: 'epic',      req: s => s.streak >= 7 },
   { id: 'party_host',     name: 'Party Host',         desc: 'Host a Watch Party',                   icon: '🎉', rarity: 'epic',      req: () => AppState._hostedParty },
   { id: 'night_100',      name: 'Century',            desc: 'Watch 100+ hours',                     icon: '💯', rarity: 'epic',      req: s => s.hoursWatched >= 100 },
   { id: 'all_genres',     name: 'Genre Master',       desc: 'Watch from 10 different genres',       icon: '🌈', rarity: 'epic',      req: s => Object.keys(s.topGenres || {}).length >= 10 },
   { id: 'konami',         name: 'Konami Master',      desc: 'Activate the Konami code',             icon: '🕹️', rarity: 'legendary', req: () => AppState._konami },
   { id: 'night_200',      name: 'No Life',            desc: 'Watch 200+ hours',                     icon: '👑', rarity: 'legendary', req: s => s.hoursWatched >= 200 },
];


/* ── UTILITIES ──────────────────────────────────────────────────────────────── */
function esc(str) {
   if (!str) return '';
   return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function norm(item, fallback = 'movie') {
   if (!item) return null;
   const mt = item.media_type || fallback;
   if (mt === 'person') return null;
   return {
      id: String(item.id),
      title: item.title || item.name || 'Untitled',
      type: mt,
      poster: item.poster_path ? `${CONFIG.IMG_W500}${item.poster_path}` : null,
      poster_sm: item.poster_path ? `${CONFIG.IMG_BASE}/w185${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `${CONFIG.IMG_W1280}${item.backdrop_path}` : null,
      backdrop_orig: item.backdrop_path ? `${CONFIG.IMG_ORIG}${item.backdrop_path}` : null,
      desc: item.overview || '',
      rating: item.vote_average ? parseFloat(item.vote_average.toFixed(1)) : null,
      votes: item.vote_count || 0,
      year: (item.release_date || item.first_air_date || '').slice(0, 4) || null,
      genreIds: item.genre_ids || [],
      popularity: item.popularity || 0,
   };
}

function genreNames(ids) {
   return (ids || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 3);
}

function matchPct(r) { return Math.min(99, Math.max(1, Math.round((parseFloat(r) || 0) * 10))); }

function fmtRuntime(min) {
   if (!min) return '';
   const h = Math.floor(min / 60), m = min % 60;
   return h ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}

function fmtDate(dateStr) {
   if (!dateStr) return '';
   try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
   catch { return dateStr; }
}

function relTime(ts) {
   const d = Date.now() - ts;
   if (d < 60000) return 'just now';
   if (d < 3600000) return `${Math.floor(d/60000)}m ago`;
   if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
   return `${Math.floor(d/86400000)}d ago`;
}

function qualityLabel(item, type) {
   const yr = parseInt((item.release_date || item.first_air_date || '0').slice(0, 4));
   const now = new Date().getFullYear();
   const v = item.vote_count || 0;
   if (type === 'movie' && now === yr && v < 500) return { label: 'CAM', cls: 'q-cam', cam: true };
   if ((item.vote_average || 0) >= 8) return { label: '4K', cls: 'q-4k', cam: false };
   if ((item.vote_average || 0) >= 7) return { label: 'HD', cls: 'q-hd', cam: false };
   return { label: 'SD', cls: 'q-sd', cam: false };
}

function vibrate(l = 'light') {
   if (!navigator.vibrate || AppState.settings.hapticIntensity === 0) return;
   const i = (AppState.settings.hapticIntensity || 50) / 100;
   const patterns = { light: [Math.round(20*i)], medium: [Math.round(30*i), 10, Math.round(30*i)], heavy: [Math.round(50*i), 20, Math.round(50*i), 20, Math.round(50*i)] };
   navigator.vibrate(patterns[l] || patterns.light);
}

function debounce(fn, ms) {
   let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function throttle(fn, ms) {
   let last = 0; return (...args) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...args); } };
}

function deepClone(obj) { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } }

function getEmbedUrl(overrideServer = null) {
   const id = State.get('currentId'), type = State.get('currentType');
   const srv = overrideServer ?? State.get('currentServer');
   const s = State.get('currentSeason'), e = State.get('currentEpisode');
   if (!id || !type) return '';
   let srvObj = AppState.settings.bandwidthSaver
      ? SERVERS.find(x => x.id === 'vidsrcme') || SERVERS[SERVERS.length - 1]
      : SERVERS[srv] || SERVERS[0];
   return srvObj.build(type, id, s, e);
}


/* ── TMDB API v2 — Dedup, TTL cache, retry, request queue ──────────────────── */
const TMDB = (() => {
   const cache = AppState.cache;
   const inflight = AppState.inflightRequests;

   async function _raw(url, retries = CONFIG.MAX_RETRIES) {
      for (let attempt = 0; attempt < retries; attempt++) {
         try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (res.status === 429) {
               const retry = parseInt(res.headers.get('Retry-After') || 2);
               await new Promise(r => setTimeout(r, retry * 1000 * (attempt + 1)));
               continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
         } catch (err) {
            if (attempt === retries - 1) throw err;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
         }
      }
   }

   return {
      async fetch(path, params = {}, ttl = CONFIG.CACHE_TTL) {
         const q = new URLSearchParams({ api_key: CONFIG.TMDB_KEY, language: AppState.settings.language || 'en-US', ...params }).toString();
         const url = `${CONFIG.TMDB_BASE}${path}?${q}`;

         /* TTL-aware cache check */
         if (cache.has(url)) {
            const entry = cache.get(url);
            if (Date.now() - entry.ts < ttl) return entry.data;
            cache.delete(url);
         }

         /* Deduplicate in-flight requests */
         if (inflight.has(url)) return inflight.get(url);

         const req = _raw(url)
            .then(data => {
               if (data) cache.set(url, { data, ts: Date.now() });
               inflight.delete(url);
               return data;
            })
            .catch(err => {
               inflight.delete(url);
               console.warn(`[TMDB] Failed: ${path}`, err.message);
               return null;
            });

         inflight.set(url, req);
         return req;
      },

      async fetchMulti(paths, params = {}) {
         return Promise.all(paths.map(p => this.fetch(p, params)));
      },

      clearCache() { cache.clear(); },
   };
})();


/* ── TOAST SYSTEM v2 — Queue-based, stacking, typed ────────────────────────── */
const Toast = (() => {
   let queue = [];
   let active = false;

   function _show({ msg, type = 'success', duration = 3200 }) {
      active = true;
      const t = document.getElementById('toast');
      if (!t) { active = false; _next(); return; }
      const icons = { success: 'fa-check-circle', error: 'fa-exclamation-triangle', info: 'fa-info-circle', warning: 'fa-exclamation-circle' };
      const colors = { success: 'rgba(70,211,105,.5)', error: 'rgba(229,9,20,.5)', info: 'rgba(59,130,246,.5)', warning: 'rgba(251,191,36,.5)' };
      t.className = 'toast show';
      t.style.borderColor = colors[type] || colors.info;
      t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
      vibrate('light');
      clearTimeout(t._timer);
      t._timer = setTimeout(() => {
         t.classList.remove('show');
         setTimeout(() => { active = false; _next(); }, 400);
      }, duration);
   }

   function _next() {
      if (queue.length && !active) _show(queue.shift());
   }

   return {
      show(msg, type = 'success', duration = 3200) {
         queue.push({ msg, type, duration });
         _next();
      }
   };
})();

function showToast(msg, type = 'success', duration = 3200) { Toast.show(msg, type, duration); }


/* ── PROFILE SYSTEM ─────────────────────────────────────────────────────────── */
let _pendingProfilePin = null;

function showProfiles() {
   document.getElementById('navbar').style.display = 'none';
   document.getElementById('pageHome').style.display = 'none';
   document.getElementById('siteFooter').style.display = 'none';
   const list = document.getElementById('profileList');
   if (!list) return;
   list.innerHTML = AppState.profiles.map(p => `
      <div class="profile-card" onclick="selectProfile('${p.id}')">
         <img src="${esc(p.avatar)}" alt="${esc(p.name)}" loading="lazy">
         <span>${esc(p.name)}</span>
         ${p.pin ? '<div class="profile-pin-badge"><i class="fas fa-lock"></i></div>' : ''}
      </div>`).join('') +
      `<div class="profile-card" onclick="promptAddProfile()">
         <div class="profile-add-circle"><i class="fas fa-plus"></i></div>
         <span>Add Profile</span>
      </div>`;
   const screen = document.getElementById('profileScreen');
   if (screen) { screen.style.display = 'flex'; screen.style.opacity = '1'; screen.style.visibility = 'visible'; }
}

function selectProfile(id) {
   const profile = AppState.profiles.find(p => p.id === id);
   if (!profile) return;
   if (profile.pin) {
      _pendingProfilePin = id;
      _showPinPrompt(profile.name);
      return;
   }
   _activateProfile(id);
}

function _showPinPrompt(name) {
   const existing = document.getElementById('pinPromptOverlay');
   if (existing) existing.remove();
   const overlay = document.createElement('div');
   overlay.id = 'pinPromptOverlay';
   overlay.innerHTML = `
      <div class="pin-prompt-box">
         <h3>Enter PIN for <span>${esc(name)}</span></h3>
         <div class="pin-dots" id="pinDots"><span></span><span></span><span></span><span></span></div>
         <div class="pin-keypad">
            ${[1,2,3,4,5,6,7,8,9,'',0,'<i class="fas fa-backspace"></i>'].map((k,i) => `<button class="pin-key" onclick="_pinKey('${k}')" ${k==='' ? 'disabled' : ''}>${k}</button>`).join('')}
         </div>
         <button class="pin-cancel-btn" onclick="document.getElementById('pinPromptOverlay').remove()">Cancel</button>
      </div>`;
   document.body.appendChild(overlay);
   window._pinBuffer = '';
}

window._pinKey = function(k) {
   if (k === '<i class="fas fa-backspace"></i>') { window._pinBuffer = window._pinBuffer.slice(0, -1); }
   else if (window._pinBuffer.length < 4) { window._pinBuffer += k; }
   const dots = document.querySelectorAll('#pinDots span');
   dots.forEach((d, i) => d.classList.toggle('filled', i < window._pinBuffer.length));
   if (window._pinBuffer.length === 4) {
      const profile = AppState.profiles.find(p => p.id === _pendingProfilePin);
      if (profile && window._pinBuffer === profile.pin) {
         document.getElementById('pinPromptOverlay')?.remove();
         _activateProfile(_pendingProfilePin);
      } else {
         const box = document.querySelector('.pin-prompt-box');
         if (box) { box.classList.add('pin-shake'); setTimeout(() => box.classList.remove('pin-shake'), 500); }
         window._pinBuffer = '';
         document.querySelectorAll('#pinDots span').forEach(d => d.classList.remove('filled'));
         showToast('Incorrect PIN', 'error');
      }
   }
};

function _activateProfile(id) {
   AppState.currentProfile = AppState.profiles.find(p => p.id === id);
   if (!AppState.currentProfile) return;
   const { avatar, name } = AppState.currentProfile;
   const navImg = document.getElementById('navAvatarImg');
   const dropImg = document.getElementById('dropAvatarImg');
   const dropName = document.getElementById('dropProfileName');
   if (navImg) navImg.innerHTML = `<img src="${esc(avatar)}" alt="${esc(name)}">`;
   if (dropImg) dropImg.innerHTML = `<img src="${esc(avatar)}" alt="${esc(name)}">`;
   if (dropName) dropName.textContent = name;
   vibrate('light');
   const screen = document.getElementById('profileScreen');
   if (screen) {
      screen.style.opacity = '0';
      screen.style.visibility = 'hidden';
      setTimeout(() => {
         screen.style.display = 'none';
         document.getElementById('navbar').style.display = 'flex';
         document.getElementById('pageHome').style.display = 'block';
         document.getElementById('siteFooter').style.display = 'block';
         EventBus.emit('profile:selected', AppState.currentProfile);
      }, 600);
   }
}

function promptAddProfile() {
   const name = prompt('Profile name:');
   if (!name?.trim()) return;
   const seeds = ['Phoenix','Nova','Atlas','Echo','Zephyr','Luna','Orion','Vega'];
   const seed = seeds[Math.floor(Math.random() * seeds.length)];
   const colors = ['b6e3f4','ffd5dc','c0aede','d1f4e0','ffeaa7','ffb3c6','bee3f8','fbd5e5'];
   const color = colors[Math.floor(Math.random() * colors.length)];
   const newProfile = {
      id: `p${Date.now()}`,
      name: name.trim(),
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&backgroundColor=${color}`,
      pin: null,
      settings: {}
   };
   AppState.profiles.push(newProfile);
   SafeStorage.set('bb_profiles', AppState.profiles);
   showProfiles();
   showToast(`Profile "${name.trim()}" created!`, 'success');
}


/* ── NAVBAR ────────────────────────────────────────────────────────────────── */
const Navbar = {
   init() {
      window.addEventListener('scroll', throttle(() => {
         const nav = document.getElementById('navbar');
         if (nav) nav.classList.toggle('solid', window.scrollY > 60);
      }, 50), { passive: true });

      document.addEventListener('click', e => {
         if (!e.target.closest('#accountMenu')) this.closeAccountDropdown();
         if (!e.target.closest('#notifToggle') && !e.target.closest('#notifPanel')) {
            const p = document.getElementById('notifPanel');
            if (p) p.classList.remove('open');
            State.set('notifPanelOpen', false);
         }
         if (!e.target.closest('#mobileNav') && !e.target.closest('.mobile-menu-btn')) this.closeMobileMenu();
         const cm = document.getElementById('context-menu');
         if (cm && !cm.contains(e.target)) cm.style.display = 'none';
      });

      this._setupNotifications();
   },

   toggleMobileMenu() { document.getElementById('mobileNav')?.classList.toggle('open'); },
   closeMobileMenu()  { document.getElementById('mobileNav')?.classList.remove('open'); },
   toggleAccountDropdown() { document.getElementById('accountDropdown')?.classList.toggle('open'); },
   closeAccountDropdown()  { document.getElementById('accountDropdown')?.classList.remove('open'); },

   toggleNotifPanel() {
      const p = document.getElementById('notifPanel');
      if (!p) return;
      const open = State.toggle('notifPanelOpen');
      p.classList.toggle('open', open);
      if (open) {
         const badge = document.getElementById('notifBadge');
         if (badge) badge.style.display = 'none';
         this._renderNotifications();
      }
   },

   _notifications: SafeStorage.get('bb_notifs', [
      { id: 'n1', title: 'Welcome back!', body: 'BingeBox Omega is ready.', time: Date.now(), read: false, icon: '🎬' },
   ]),

   _setupNotifications() {
      EventBus.on('profile:selected', ({ name }) => {
         this.addNotification(`Welcome, ${name}!`, 'Your list and history are loaded.', '👋');
      });
   },

   addNotification(title, body, icon = '🔔') {
      this._notifications.unshift({ id: `n${Date.now()}`, title, body, time: Date.now(), read: false, icon });
      this._notifications = this._notifications.slice(0, 50);
      SafeStorage.set('bb_notifs', this._notifications);
      const badge = document.getElementById('notifBadge');
      if (badge) badge.style.display = '';
   },

   _renderNotifications() {
      const container = document.getElementById('notifList');
      if (!container) return;
      const unread = this._notifications.filter(n => !n.read);
      if (!this._notifications.length) { container.innerHTML = '<p class="notif-empty">No notifications</p>'; return; }
      container.innerHTML = this._notifications.slice(0, 15).map(n => `
         <div class="notif-item ${n.read ? '' : 'unread'}" onclick="Navbar._markRead('${n.id}')">
            <span class="notif-icon">${n.icon}</span>
            <div class="notif-body">
               <p class="notif-title">${esc(n.title)}</p>
               <p class="notif-text">${esc(n.body)}</p>
               <p class="notif-time">${relTime(n.time)}</p>
            </div>
         </div>`).join('');
      this._notifications.forEach(n => n.read = true);
      SafeStorage.set('bb_notifs', this._notifications);
   },

   _markRead(id) {
      const n = this._notifications.find(x => x.id === id);
      if (n) n.read = true;
   },
};


/* ── HERO v2 — Swipe, trailer, preload, parallax ────────────────────────────── */
const Hero = {
   _interval: null,
   _touchStart: 0,
   _touchStartY: 0,

   render(item) {
      const el = document.getElementById('hero');
      if (!el || !item) return;
      el.style.cssText = item.backdrop
         ? `background-image:linear-gradient(77deg,rgba(0,0,0,.9) 0%,rgba(0,0,0,.55) 45%,rgba(0,0,0,.15) 80%),url('${item.backdrop}');background-size:cover;background-position:center top;`
         : '';
      const badge = el.querySelector('.hero-badge');
      const match = el.querySelector('.hero-match');
      const title = el.querySelector('.hero-title');
      const desc  = el.querySelector('.hero-desc');
      const genres = el.querySelector('.hero-genres');
      if (badge) badge.textContent = item.type === 'tv' ? 'SERIES' : 'FILM';
      if (match) match.textContent = `${matchPct(item.rating)}% Match`;
      if (title) title.textContent = item.title;
      if (desc)  desc.textContent  = (item.desc || '').slice(0, 200) + (item.desc?.length > 200 ? '…' : '');
      if (genres) genres.innerHTML  = genreNames(item.genreIds).map(g => `<span class="hero-genre-tag">${esc(g)}</span>`).join('');

      const playBtn = el.querySelector('.hero-play-btn');
      const infoBtn = el.querySelector('.hero-info-btn');
      const trailerBtn = el.querySelector('.hero-trailer-btn');
      const wishBtn = el.querySelector('.hero-wish-btn');

      if (playBtn) playBtn.onclick = () => openDetailModal(item.id, item.type, true);
      if (infoBtn) infoBtn.onclick = () => openDetailModal(item.id, item.type, false);
      if (trailerBtn) trailerBtn.onclick = () => this.openTrailer(item.id, item.type);
      if (wishBtn) {
         const inList = State.get('wishlist').some(w => w.id === item.id);
         wishBtn.innerHTML = `<i class="fas ${inList ? 'fa-check' : 'fa-plus'}"></i> ${inList ? 'Added' : 'My List'}`;
         wishBtn.onclick = () => toggleWishlist(item.id, item.type, item.title, item.poster || '', item.year || '');
      }

      /* Update dots */
      const dots = document.querySelectorAll('.hero-dot');
      dots.forEach((d, i) => d.classList.toggle('active', i === State.get('heroIndex')));
   },

   next() {
      const items = State.get('heroItems'), len = items.length;
      if (!len) return;
      const idx = (State.get('heroIndex') + 1) % len;
      State.set('heroIndex', idx);
      this.render(items[idx]);
   },

   prev() {
      const items = State.get('heroItems'), len = items.length;
      if (!len) return;
      const idx = (State.get('heroIndex') - 1 + len) % len;
      State.set('heroIndex', idx);
      this.render(items[idx]);
   },

   jumpTo(i) {
      const items = State.get('heroItems');
      if (!items[i]) return;
      State.set('heroIndex', i);
      this.render(items[i]);
      this.restartCycle();
   },

   startCycle() {
      this.stopCycle();
      this._interval = setInterval(() => this.next(), 7000);
      const hero = document.getElementById('hero');
      if (hero) {
         hero.addEventListener('mouseenter', () => this.stopCycle(), { passive: true });
         hero.addEventListener('mouseleave', () => this.startCycle(), { passive: true });
         /* Touch swipe */
         hero.addEventListener('touchstart', e => {
            this._touchStart = e.touches[0].clientX;
            this._touchStartY = e.touches[0].clientY;
         }, { passive: true });
         hero.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - this._touchStart;
            const dy = e.changedTouches[0].clientY - this._touchStartY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
               dx < 0 ? this.next() : this.prev();
               this.restartCycle();
            }
         }, { passive: true });
      }
   },

   stopCycle() { clearInterval(this._interval); },

   restartCycle() { this.stopCycle(); this.startCycle(); },

   async load() {
      const data = await TMDB.fetch('/trending/movie/week');
      if (!data?.results) return;
      const items = data.results.slice(0, 8).map(i => norm(i, 'movie')).filter(Boolean);
      State.set('heroItems', items);
      State.set('heroIndex', 0);
      const dotsEl = document.getElementById('heroDots');
      if (dotsEl) dotsEl.innerHTML = items.map((_, i) => `<button class="hero-dot ${i===0?'active':''}" onclick="Hero.jumpTo(${i})" aria-label="Slide ${i+1}"></button>`).join('');
      this.render(items[0]);
      this.startCycle();
   },

   async openTrailer(id, type) {
      const data = await TMDB.fetch(`/${type}/${id}/videos`);
      const trailer = (data?.results || []).find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
      if (!trailer) { showToast('No trailer available', 'info'); return; }
      const overlay = document.createElement('div');
      overlay.id = 'trailerOverlay';
      overlay.innerHTML = `
         <div class="trailer-box">
            <button class="trailer-close-btn" onclick="document.getElementById('trailerOverlay').remove()"><i class="fas fa-times"></i></button>
            <iframe src="https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0" allowfullscreen allow="autoplay"></iframe>
         </div>`;
      overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
   },
};


/* ── ROWS v2 — Lazy IntersectionObserver, touch drag, virtual overflow ─────── */
const Rows = {
   card(item, badge, rank) {
      if (!item) return '';
      const mp = matchPct(item.rating);
      const inList = State.get('wishlist').some(w => w.id === item.id);
      const progress = (State.get('episodeProgress')[item.id] || {}).pct;
      const badgeHTML = badge === 'top10' && rank != null ? `<div class="top10-badge">#${rank+1}</div>`
         : badge === 'new'      ? `<div class="new-badge">NEW</div>`
         : badge === 'live'     ? `<div class="live-badge">LIVE</div>`
         : badge === 'soon'     ? `<div class="soon-badge">SOON</div>`
         : '';
      const progressBar = progress ? `<div class="card-progress"><div class="card-progress-fill" style="width:${progress}%"></div></div>` : '';
      const encodedItem = encodeURIComponent(JSON.stringify({ id: item.id, type: item.type, title: item.title, poster_path: item.poster?.split('/w500')[1], release_date: item.year+'-01-01', first_air_date: item.year+'-01-01', vote_average: item.rating }));
      return `<article class="card" tabindex="0" role="button" aria-label="${esc(item.title)}"
         onclick="openDetailModal('${esc(item.id)}','${item.type}',false)"
         oncontextmenu="showContextMenu(event,'${esc(item.id)}','${item.type}','${encodedItem}')"
         onkeydown="if(event.key==='Enter')openDetailModal('${esc(item.id)}','${item.type}',false)">
         <div class="card-img-wrap">
            ${badgeHTML}
            ${item.poster
               ? `<img class="card-img" src="${item.poster}" loading="lazy" alt="${esc(item.title)}" decoding="async">`
               : `<div class="card-img card-no-img"><i class="fas fa-film"></i></div>`}
            ${progressBar}
            <div class="card-overlay">
               <div class="card-overlay-meta">
                  <span class="card-match">${mp}% Match</span>
                  <span class="card-year">${item.year || ''}</span>
               </div>
               <div class="card-overlay-actions">
                  <button class="card-circle card-play-btn" onclick="event.stopPropagation();openDetailModal('${esc(item.id)}','${item.type}',true)" aria-label="Play">
                     <i class="fas fa-play"></i>
                  </button>
                  <button class="card-circle ${inList?'in-list':''}" onclick="event.stopPropagation();toggleWishlist('${esc(item.id)}','${item.type}','${esc(item.title)}','${item.poster||''}','${item.year||''}')" aria-label="${inList?'Remove from':'Add to'} list">
                     <i class="fas ${inList?'fa-check':'fa-plus'}"></i>
                  </button>
               </div>
               <p class="card-overlay-title">${esc(item.title)}</p>
               <p class="card-overlay-genres">${genreNames(item.genreIds).join(' • ')}</p>
            </div>
         </div>
      </article>`;
   },

   async load(rowDef) {
      const rowEl = document.getElementById(`row-${rowDef.id}`);
      if (!rowEl) return;

      /* Handle special rows */
      if (rowDef.special === 'continue') {
         const cw = State.get('continueWatching');
         if (!cw.length) { rowEl.closest('.content-row')?.style.setProperty('display','none'); return; }
         rowEl.innerHTML = cw.map(item => this.continueCard(item)).join('');
         this._initDrag(rowEl);
         return;
      }

      rowEl.innerHTML = Array(8).fill('<div class="card card-skeleton"></div>').join('');
      const data = await TMDB.fetch(rowDef.ep, { page: 1 });
      if (!data?.results) { rowEl.innerHTML = '<p class="row-error">Failed to load</p>'; return; }
      rowEl.innerHTML = data.results
         .map(i => norm(i, rowDef.mt === 'all' ? (i.media_type || 'movie') : rowDef.mt))
         .filter(Boolean)
         .slice(0, 20)
         .map((item, idx) => this.card(item, rowDef.badge, idx))
         .join('');
      this._initDrag(rowEl);
   },

   continueCard(item) {
      const pct = item.pct || 0;
      return `<article class="card card-continue" onclick="openDetailModal('${esc(item.id)}','${item.type}',true)">
         <div class="card-img-wrap">
            ${item.poster ? `<img class="card-img" src="${item.poster}" loading="lazy">` : `<div class="card-img card-no-img"><i class="fas fa-film"></i></div>`}
            <div class="card-continue-overlay"><i class="fas fa-play"></i></div>
            <div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>
         </div>
      </article>`;
   },

   buildAll() {
      const container = document.getElementById('contentRows');
      if (!container) return;
      ROWS.forEach(row => {
         const rowEl = document.createElement('div');
         rowEl.className = 'content-row';
         rowEl.id = `content-row-${row.id}`;
         rowEl.innerHTML = `
            <div class="row-header">
               <h2 class="row-title">${row.title}</h2>
               <button class="row-see-all" onclick="showCategoryFromRow('${row.id}','${row.mt}','${esc(row.title)}')">See All ›</button>
            </div>
            <div class="row-track" id="row-${row.id}" role="list"></div>`;
         container.appendChild(rowEl);

         /* Lazy-load row when visible */
         const obs = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) { obs.disconnect(); this.load(row); }
         }, { rootMargin: '200px' });
         obs.observe(rowEl);
      });
   },

   /* Mouse-drag horizontal scroll */
   _initDrag(el) {
      let isDown = false, startX = 0, scrollLeft = 0;
      el.addEventListener('mousedown', e => {
         isDown = true; el.classList.add('dragging');
         startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
      }, { passive: true });
      el.addEventListener('mouseleave', () => { isDown = false; el.classList.remove('dragging'); }, { passive: true });
      el.addEventListener('mouseup', () => { isDown = false; el.classList.remove('dragging'); }, { passive: true });
      el.addEventListener('mousemove', e => {
         if (!isDown) return;
         const x = e.pageX - el.offsetLeft;
         el.scrollLeft = scrollLeft - (x - startX) * 1.2;
      }, { passive: true });
   },
};

/* Expose to HTML onclick */
window.showCategoryFromRow = (rowId, mt, title) => {
   const row = ROWS.find(r => r.id === rowId);
   if (!row || !row.ep) return;
   showResultsPanel(title);
   State.set('currentCategoryType', mt === 'all' ? 'movie' : mt);
   State.set('currentCategory', row.ep);
   State.set('filterPage', 1);
   TMDB.fetch(row.ep, { page: 1 }).then(data => {
      const grid = document.getElementById('searchResultsGrid');
      if (!grid || !data?.results) return;
      const effectiveMt = mt === 'all' ? null : mt;
      grid.innerHTML = data.results.map(i => gridCard(norm(i, effectiveMt || (i.media_type || 'movie')))).join('');
      document.getElementById('loadMoreBtn').style.display = data.page < data.total_pages ? 'flex' : 'none';
   });
};


/* ── WATCH PARTY ENGINE v3 — Reconnect, emoji, typing, timestamps ───────────── */
const PartyEngine = {
   ws: null,
   room: null,
   isHost: false,
   _pingInterval: null,
   _reconnectTimer: null,
   _reconnectAttempts: 0,
   _maxReconnect: 5,
   _typingTimer: null,
   url: 'wss://echo.websocket.events',
   users: [],
   reactions: ['❤️','😂','😮','😭','🔥','👏','💀','🎉'],

   connect(code) {
      this.room = code;
      this._reconnectAttempts = 0;
      this._doConnect();
   },

   _doConnect() {
      try { this.ws = new WebSocket(this.url); } catch (e) { this.addSysMsg('WebSocket not supported.'); return; }
      this.ws.onopen = () => {
         this._reconnectAttempts = 0;
         document.getElementById('partySidebar')?.classList.add('open');
         document.getElementById('partyModal').style.display = 'none';
         document.getElementById('partyCodeDisplay').innerText = this.room;
         this.addSysMsg(`✅ Connected to Room: ${this.room}`);
         this._startPing();
         if (this.isHost) this.broadcastSync();
         EventBus.emit('party:connected', { room: this.room, isHost: this.isHost });
         if (this.isHost) AppState._hostedParty = true;
      };
      this.ws.onmessage = e => {
         try {
            const data = JSON.parse(e.data);
            if (data.type === 'chat') this.addChatMsg(data.msg, false, data.user, data.ts);
            if (data.type === 'reaction') this._showReactionBurst(data.emoji);
            if (data.type === 'typing') this._showTyping(data.user);
            if (data.type === 'ping') return;
            if (data.type === 'sync' && !this.isHost) {
               if (State.get('currentId') !== data.mediaId) {
                  this.addSysMsg('⚡ Host changed content. Syncing…');
                  openDetailModal(data.mediaId, data.mediaType);
               }
            }
         } catch {
            if (!e.data.includes('echo.websocket.events')) this.addChatMsg(e.data, false, 'Guest', Date.now());
         }
      };
      this.ws.onclose = () => {
         this._stopPing();
         this.addSysMsg('⚠️ Disconnected from party server.');
         if (this._reconnectAttempts < this._maxReconnect) {
            const delay = Math.pow(2, this._reconnectAttempts) * 1000;
            this.addSysMsg(`🔄 Reconnecting in ${delay/1000}s… (attempt ${this._reconnectAttempts + 1}/${this._maxReconnect})`);
            this._reconnectTimer = setTimeout(() => {
               this._reconnectAttempts++;
               this._doConnect();
            }, delay);
         } else {
            this.addSysMsg('❌ Could not reconnect. Please rejoin manually.');
         }
      };
      this.ws.onerror = () => this.addSysMsg('⚠️ Party connection error.');
   },

   _startPing() {
      this._pingInterval = setInterval(() => {
         if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
   },

   _stopPing() { clearInterval(this._pingInterval); },

   promptCreate() {
      const id = State.get('currentId');
      if (!id) { showToast('Open a movie or show first!', 'info'); return; }
      this.isHost = true;
      const code = Math.floor(10000000 + Math.random() * 90000000).toString();
      this.connect(code);
      vibrate('heavy');
      /* Copy code to clipboard */
      navigator.clipboard?.writeText(code).then(() => showToast(`Party code ${code} copied!`, 'success'));
   },

   showJoinModal() { const m = document.getElementById('partyModal'); if (m) m.style.display = 'flex'; },

   joinRoom() {
      const input = document.getElementById('partyJoinCode');
      const code = input?.value?.trim();
      if (!code || code.length !== 8) { showToast('Enter a valid 8-digit code', 'error'); return; }
      this.isHost = false;
      this.connect(code);
   },

   leaveRoom() {
      clearTimeout(this._reconnectTimer);
      this._reconnectAttempts = this._maxReconnect; // prevent auto-reconnect
      if (this.ws) this.ws.close();
      document.getElementById('partySidebar')?.classList.remove('open');
      this.room = null;
      showToast('Left the party', 'info');
   },

   sendMessage() {
      const input = document.getElementById('partyInput');
      if (!input?.value.trim() || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const msg = input.value.trim();
      const payload = JSON.stringify({ type: 'chat', msg, user: AppState.currentProfile?.name || 'You', ts: Date.now() });
      this.ws.send(payload);
      this.addChatMsg(msg, true, AppState.currentProfile?.name || 'You', Date.now());
      input.value = '';
   },

   sendReaction(emoji) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: 'reaction', emoji }));
      this._showReactionBurst(emoji);
   },

   _showReactionBurst(emoji) {
      const sidebar = document.getElementById('partySidebar');
      if (!sidebar) return;
      const el = document.createElement('div');
      el.className = 'reaction-burst';
      el.textContent = emoji;
      el.style.cssText = `left:${20 + Math.random()*60}%;`;
      sidebar.appendChild(el);
      setTimeout(() => el.remove(), 2000);
   },

   sendTyping() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      clearTimeout(this._typingTimer);
      this.ws.send(JSON.stringify({ type: 'typing', user: AppState.currentProfile?.name || 'Someone' }));
   },

   _showTyping(user) {
      const indicator = document.getElementById('partyTypingIndicator');
      if (!indicator) return;
      indicator.textContent = `${user} is typing…`;
      indicator.style.display = '';
      clearTimeout(this._typingTimer);
      this._typingTimer = setTimeout(() => { if (indicator) indicator.style.display = 'none'; }, 2000);
   },

   broadcastSync() {
      if (this.ws?.readyState === WebSocket.OPEN && this.isHost) {
         this.ws.send(JSON.stringify({ type: 'sync', mediaId: State.get('currentId'), mediaType: State.get('currentType') }));
      }
   },

   addChatMsg(text, isSelf, user = '', ts = Date.now()) {
      const c = document.getElementById('partyChat');
      if (!c) return;
      const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      c.insertAdjacentHTML('beforeend', `
         <div class="party-msg ${isSelf?'self':''}">
            ${!isSelf && user ? `<span class="party-msg-user">${esc(user)}</span>` : ''}
            <span class="party-msg-text">${esc(text)}</span>
            <span class="party-msg-time">${time}</span>
         </div>`);
      c.scrollTop = c.scrollHeight;
      if (!isSelf) vibrate('light');
   },

   addSysMsg(text) {
      const c = document.getElementById('partyChat');
      if (!c) return;
      c.insertAdjacentHTML('beforeend', `<div class="party-msg sys">${esc(text)}</div>`);
      c.scrollTop = c.scrollHeight;
   },

   renderReactionBar() {
      const bar = document.getElementById('partyReactionBar');
      if (!bar) return;
      bar.innerHTML = this.reactions.map(e => `<button class="reaction-btn" onclick="PartyEngine.sendReaction('${e}')">${e}</button>`).join('');
   },
};


/* ── DETAIL MODAL v2 — Cast, trailers, reviews, episode progress ─────────────── */
async function openDetailModal(id, type, autoPlay = false) {
   State.set('currentId', String(id));
   State.set('currentType', type);
   State.set('currentSeason', 1);
   State.set('currentEpisode', 1);
   State.set('currentServer', 0);

   const body = document.getElementById('detailBody');
   if (!body) return;
   body.innerHTML = `<div class="detail-loading"><div class="detail-spinner"></div><span>Loading…</span></div>`;
   const overlay = document.getElementById('detailOverlay');
   overlay?.classList.add('active');
   document.body.style.overflow = 'hidden';
   history.pushState({ view: 'modal', id, type }, '');

   try {
      const [detail, credits, similar, videos] = await Promise.all([
         TMDB.fetch(`/${type}/${id}`, { append_to_response: 'release_dates,content_ratings' }),
         TMDB.fetch(`/${type}/${id}/credits`),
         TMDB.fetch(`/${type}/${id}/similar`, { page: 1 }),
         TMDB.fetch(`/${type}/${id}/videos`),
      ]);

      if (!detail) throw new Error('No data');

      const item = norm(detail, type);
      const title = detail.title || detail.name || '';
      const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
      const mp = matchPct(detail.vote_average);
      const q = qualityLabel(detail, type);
      const inList = State.get('wishlist').some(w => w.id === String(id));
      const ns = detail.number_of_seasons || 0;
      const runtime = fmtRuntime(detail.runtime || detail.episode_run_time?.[0]);
      const trailer = (videos?.results || []).find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));

      /* Cast cards */
      const cast = (credits?.cast || []).slice(0, 12);
      const castHTML = cast.length && AppState.settings.showCastSection ? `
         <div class="cast-section">
            <h3 class="detail-section-title">Cast</h3>
            <div class="cast-row">
               ${cast.map(c => `
                  <div class="cast-card">
                     ${c.profile_path
                        ? `<img class="cast-img" src="${CONFIG.IMG_BASE}/w185${c.profile_path}" loading="lazy" alt="${esc(c.name)}">`
                        : `<div class="cast-img cast-no-img"><i class="fas fa-user"></i></div>`}
                     <p class="cast-name">${esc(c.name)}</p>
                     <p class="cast-character">${esc(c.character || '')}</p>
                  </div>`).join('')}
            </div>
         </div>` : '';

      /* Similar cards */
      const simCards = (similar?.results || []).slice(0, 8).map(s => norm(s, type)).filter(Boolean).map(s => `
         <article class="sim-card" onclick="openDetailModal('${s.id}','${s.type}',false)">
            ${s.poster ? `<img class="sim-card-img" src="${s.poster}" loading="lazy">` : '<div class="sim-card-img sim-no-img"><i class="fas fa-film"></i></div>'}
            <div class="sim-card-body">
               <div class="sim-card-head"><span class="sim-match">${matchPct(s.rating)}% Match</span><span class="sim-year">${s.year||''}</span></div>
               <p class="sim-card-title">${esc(s.title)}</p>
               <p class="sim-card-desc">${esc((s.desc||'').slice(0,120))}</p>
            </div>
         </article>`).join('');

      /* Content rating */
      const ratings = detail.release_dates?.results || detail.content_ratings?.results || [];
      const usRating = ratings.find(r => r.iso_3166_1 === 'US');
      const contentRating = usRating?.release_dates?.[0]?.certification || usRating?.rating || '';

      body.innerHTML = `
         <button class="modal-close" onclick="closeDetailModal()" aria-label="Close"><i class="fas fa-times"></i></button>
         <div class="detail-hero" style="${item?.backdrop ? `background-image:url('${item.backdrop}')` : ''};background-size:cover;background-position:center;">
            <div class="detail-hero-fade"></div>
            <div class="detail-hero-inner">
               <h2 class="detail-hero-title">${esc(title)}</h2>
               <div class="detail-hero-actions">
                  <button class="btn-play-primary" onclick="startPlaying()"><i class="fas fa-play"></i> Play Now</button>
                  ${trailer ? `<button class="btn-trailer" onclick="Hero.openTrailer('${id}','${type}')"><i class="fab fa-youtube"></i> Trailer</button>` : ''}
                  <button class="btn-party" onclick="PartyEngine.promptCreate()"><i class="fas fa-users"></i> Watch Party</button>
                  <button class="circle-action ${inList?'in-list':''}" id="detailListBtn" onclick="toggleWishlist('${id}','${type}','${esc(title)}','${item?.poster||''}','${year}')" aria-label="${inList?'Remove from':'Add to'} list">
                     <i class="fas ${inList?'fa-check':'fa-plus'}"></i>
                  </button>
                  <button class="circle-action" onclick="shareMedia('${esc(title)}','${id}','${type}')" aria-label="Share"><i class="fas fa-share-alt"></i></button>
               </div>
            </div>
         </div>

         <div class="player-section" id="playerSection" style="display:none;">
            <div class="player-box" id="playerBox">
               <iframe id="streamPlayer" allowfullscreen allow="autoplay;fullscreen;picture-in-picture" referrerpolicy="no-referrer"></iframe>
               <div class="player-bar">
                  <div class="player-bar-left">
                     <span class="media-quality ${q.cls}">${q.label}</span>
                     <span class="player-title-label">${esc(title)}</span>
                  </div>
                  <div class="player-bar-right">
                     <button class="pbtn" onclick="openServerPicker()" title="Change server"><i class="fas fa-server"></i> <span id="serverName">${SERVERS[0].name}</span></button>
                     <button class="pbtn" id="fsBtn" onclick="goFullscreen()"><i class="fas fa-expand"></i> Cinema</button>
                     ${type === 'tv' ? `<button class="pbtn" onclick="nextEpisode()"><i class="fas fa-forward"></i> Next Ep</button>` : ''}
                  </div>
               </div>
               <div id="serverPickerDropdown" class="server-picker-dropdown" style="display:none;">
                  ${SERVERS.map((srv, i) => `
                     <button class="server-option ${i === State.get('currentServer') ? 'active' : ''}" onclick="switchServerTo(${i})">
                        <span>${srv.badge} ${srv.name}</span>
                        <span class="server-status ${srv.status === 'ok' ? 'status-ok' : 'status-err'}">●</span>
                     </button>`).join('')}
               </div>
            </div>
         </div>

         <div class="detail-body">
            <div class="detail-meta-row">
               <span class="match-badge">${mp}% Match</span>
               <span class="year-badge">${year}</span>
               ${runtime ? `<span class="runtime-badge">${runtime}</span>` : ''}
               ${contentRating ? `<span class="rating-badge">${esc(contentRating)}</span>` : ''}
               <span class="media-quality ${q.cls}">${q.label}</span>
            </div>
            <p class="detail-desc">${esc(detail.overview || 'No overview available.')}</p>
            <div class="detail-info-row">
               ${detail.genres?.length ? `<p><span class="info-label">Genres:</span> ${detail.genres.map(g => `<button class="genre-tag-btn" onclick="filterByGenre(${g.id},'${esc(g.name)}')">${esc(g.name)}</button>`).join('')}</p>` : ''}
               ${type === 'tv' && ns > 0 ? `<p><span class="info-label">Seasons:</span> ${ns}</p>` : ''}
               ${detail.production_companies?.[0] ? `<p><span class="info-label">Studio:</span> ${esc(detail.production_companies[0].name)}</p>` : ''}
            </div>

            ${type === 'tv' && ns > 0 ? `
            <div class="episodes-section mt-6">
               <div class="episodes-top">
                  <h3 class="detail-section-title">Episodes</h3>
                  <select class="season-select" onchange="loadEpisodes(${id},parseInt(this.value))">
                     ${Array.from({length:ns},(_,i)=>`<option value="${i+1}">Season ${i+1}</option>`).join('')}
                  </select>
               </div>
               <div class="ep-list" id="epList"></div>
            </div>` : ''}

            ${castHTML}
            ${simCards ? `<div class="similar-section mt-6"><h3 class="detail-section-title">More Like This</h3><div class="similar-grid">${simCards}</div></div>` : ''}
         </div>`;

      if (type === 'tv' && ns > 0) loadEpisodes(id, 1);
      if (autoPlay) setTimeout(() => startPlaying(), 350);
      if (!AppState.settings.privacyMode) {
         addToHistory(String(id), type, title, item?.poster || '', year);
         _trackStats(type, detail.genres || []);
      }
      if (PartyEngine.isHost) PartyEngine.broadcastSync();

   } catch (err) {
      body.innerHTML = `<div class="detail-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load details.</p><button class="btn-retry" onclick="openDetailModal('${id}','${type}',${autoPlay})">Try Again</button></div>`;
   }
}

function closeDetailModal() {
   document.getElementById('detailOverlay')?.classList.remove('active');
   document.body.style.overflow = '';
   const iframe = document.getElementById('streamPlayer');
   if (iframe) iframe.src = '';
   if (history.state?.view === 'modal') history.back();
   if (document.getElementById('playerBox')?.classList.contains('cinema-mode')) _exitCinema();
}

function startPlaying() {
   const sec = document.getElementById('playerSection');
   const iframe = document.getElementById('streamPlayer');
   const pBox = document.getElementById('playerBox');
   if (!sec || !iframe) return;
   sec.style.display = 'block';
   pBox.classList.toggle('glow-active', !!AppState.settings.ambientGlow);
   iframe.src = getEmbedUrl();
   sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
   _updateContinueWatching();
   showToast('Stream started — OmegaShield active!', 'success');
   EventBus.emit('player:start', { id: State.get('currentId'), type: State.get('currentType') });
   vibrate('medium');
}

function switchServer() {
   let srv = (State.get('currentServer') + 1) % SERVERS.length;
   switchServerTo(srv);
}

function switchServerTo(idx) {
   State.set('currentServer', idx);
   const iframe = document.getElementById('streamPlayer');
   if (iframe?.src) iframe.src = getEmbedUrl();
   const nameEl = document.getElementById('serverName');
   if (nameEl) nameEl.textContent = SERVERS[idx]?.name || '';
   /* Update picker active state */
   document.querySelectorAll('.server-option').forEach((el, i) => el.classList.toggle('active', i === idx));
   document.getElementById('serverPickerDropdown').style.display = 'none';
   showToast(`Switched to ${SERVERS[idx]?.name}`);
}

function openServerPicker() {
   const dd = document.getElementById('serverPickerDropdown');
   if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function nextEpisode() {
   const id = State.get('currentId');
   const season = State.get('currentSeason');
   const ep = State.get('currentEpisode');
   State.set('currentEpisode', ep + 1);
   startPlaying();
   showToast(`Playing S${season}E${ep + 1}`);
   /* Update active ep card */
   document.querySelectorAll('.ep-card').forEach(c => {
      const epNum = parseInt(c.dataset.ep);
      c.classList.toggle('ep-active', epNum === ep + 1);
   });
}

function goFullscreen() {
   const box = document.getElementById('playerBox');
   const btn = document.getElementById('fsBtn');
   const backdrop = document.getElementById('cinemaBackdrop');
   const overlay = document.getElementById('detailOverlay');
   if (!box) return;
   if (AppState.settings.cinemaDim) {
      const entering = !box.classList.contains('cinema-mode');
      box.classList.toggle('cinema-mode', entering);
      if (overlay) overlay.style.overflowY = entering ? 'hidden' : 'auto';
      if (backdrop) { backdrop.style.opacity = entering ? '1' : '0'; backdrop.style.pointerEvents = entering ? 'auto' : 'none'; }
      if (btn) btn.innerHTML = entering ? '<i class="fas fa-compress"></i> Exit Cinema' : '<i class="fas fa-expand"></i> Cinema Mode';
      if (!entering) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
   } else {
      if (!document.fullscreenElement) box.requestFullscreen().catch(e => console.warn(e));
      else document.exitFullscreen();
   }
}

function _exitCinema() {
   const box = document.getElementById('playerBox');
   if (box?.classList.contains('cinema-mode')) goFullscreen();
}


/* ── EPISODES — with progress tracking ─────────────────────────────────────── */
async function loadEpisodes(tvId, season) {
   State.set('currentSeason', parseInt(season));
   State.set('currentEpisode', 1);
   const list = document.getElementById('epList');
   if (!list) return;
   list.innerHTML = '<div class="ep-loading"><div class="detail-spinner"></div></div>';
   try {
      const data = await TMDB.fetch(`/tv/${tvId}/season/${season}`);
      const progress = State.get('episodeProgress')[tvId] || {};
      list.innerHTML = (data?.episodes || []).map(ep => {
         const epPct = progress[`s${season}e${ep.episode_number}`] || 0;
         return `<div class="ep-card ${epPct >= 90 ? 'ep-watched' : ''}" data-ep="${ep.episode_number}"
            onclick="playEpisode(${tvId},${season},${ep.episode_number},this)">
            <div class="ep-index">${ep.episode_number}</div>
            <div class="ep-thumb" style="${ep.still_path?`background-image:url('${CONFIG.IMG_BASE}/w300${ep.still_path}')`:''};background-color:#222;background-size:cover;">
               <div class="ep-play-overlay"><svg viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>
               ${epPct > 0 && epPct < 90 ? `<div class="ep-progress-bar"><div style="width:${epPct}%"></div></div>` : ''}
               ${epPct >= 90 ? '<div class="ep-watched-badge"><i class="fas fa-check"></i></div>' : ''}
            </div>
            <div class="ep-info">
               <div class="ep-name">${esc(ep.name || `Episode ${ep.episode_number}`)}</div>
               ${ep.air_date ? `<div class="ep-airdate">${fmtDate(ep.air_date)}</div>` : ''}
               <p class="ep-synopsis">${esc((ep.overview || '').slice(0, 160))}${ep.overview?.length > 160 ? '…' : ''}</p>
            </div>
         </div>`;
      }).join('');
   } catch { list.innerHTML = '<p class="ep-error">Failed to load episodes.</p>'; }
}

function playEpisode(tvId, season, episode, btn) {
   State.set('currentSeason', season);
   State.set('currentEpisode', episode);
   document.querySelectorAll('.ep-card').forEach(c => c.classList.remove('ep-active'));
   if (btn) btn.classList.add('ep-active');
   startPlaying();
   showToast(`Playing S${season}E${episode}`, 'info');
}

function _updateContinueWatching() {
   const id = State.get('currentId'), type = State.get('currentType');
   if (!id || AppState.settings.privacyMode) return;
   const cw = State.get('continueWatching').filter(x => x.id !== id);
   const histItem = State.get('watchHistory').find(h => h.id === id);
   cw.unshift({ id, type, title: histItem?.title || '', poster: histItem?.poster || '', pct: 15, watchedAt: Date.now() });
   State.set('continueWatching', cw.slice(0, 20));
   State.persist();
}


/* ── SEARCH ENGINE v2 — AbortController, trending, recent history ───────────── */
const Search = (() => {
   let _debounce = null, _sugDebounce = null, _abortCtrl = null;

   function open() {
      State.set('searchOpen', true);
      document.getElementById('searchWrapper')?.classList.add('open');
      document.getElementById('searchInput')?.focus();
      _showRecentSearches();
   }
   function close() {
      State.set('searchOpen', false);
      document.getElementById('searchWrapper')?.classList.remove('open');
      const inp = document.getElementById('searchInput');
      if (inp) inp.value = '';
      hideSugg();
   }
   function toggle() { State.get('searchOpen') ? close() : open(); }
   function hideSugg() { document.getElementById('searchSuggestions')?.classList.remove('active'); }

   function _showRecentSearches() {
      const sug = document.getElementById('searchSuggestions');
      const recent = AppState.recentSearches;
      if (!sug || !recent.length) return;
      sug.innerHTML = `
         <div class="suggest-section-title">Recent Searches</div>
         ${recent.slice(0, 5).map(q => `
            <div class="suggest-item suggest-recent" onclick="Search.triggerFull('${esc(q)}')">
               <i class="fas fa-history suggest-icon"></i>
               <span>${esc(q)}</span>
               <button class="suggest-remove" onclick="event.stopPropagation();Search._removeRecent('${esc(q)}')">✕</button>
            </div>`).join('')}
         <div class="suggest-footer" onclick="Search._clearRecent()">Clear history</div>`;
      sug.classList.add('active');
   }

   function _saveRecentSearch(q) {
      let recent = AppState.recentSearches.filter(r => r !== q);
      recent.unshift(q);
      AppState.recentSearches = recent.slice(0, 10);
      SafeStorage.set('bb_recent_searches', AppState.recentSearches);
   }

   function onKeydown(e) {
      const q = e.target.value.trim();
      if (e.key === 'Enter' && q) {
         clearTimeout(_debounce);
         hideSugg();
         _saveRecentSearch(q);
         State.set('searchQuery', q);
         State.set('searchPage', 1);
         doSearch();
         return;
      }
      if (e.key === 'Escape') { close(); return; }
      if (!q) { hideSugg(); if (document.getElementById('pageResults')?.classList.contains('active')) goHome(); return; }
      clearTimeout(_sugDebounce);
      _sugDebounce = setTimeout(() => loadSugg(q), 250);
      if (q.length >= 3) {
         clearTimeout(_debounce);
         _debounce = setTimeout(() => { State.set('searchQuery', q); State.set('searchPage', 1); doSearch(); }, 550);
      }
   }

   async function loadSugg(q) {
      _abortCtrl?.abort();
      _abortCtrl = new AbortController();
      const sug = document.getElementById('searchSuggestions');
      if (!sug) return;
      const data = await TMDB.fetch('/search/multi', { query: q, page: 1 });
      if (!data) return;
      const results = (data.results || []).filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path).slice(0, 6);
      if (!results.length) { hideSugg(); return; }
      sug.innerHTML = results.map(r => {
         const item = norm(r, r.media_type);
         return `<div class="suggest-item" onclick="openDetailModal('${item.id}','${item.type}',false);Search.close()">
            <img class="suggest-poster" src="${item.poster_sm || item.poster}" loading="lazy" alt="">
            <div class="suggest-info">
               <p class="suggest-title">${esc(item.title)}</p>
               <p class="suggest-meta">${item.type.toUpperCase()} • ${item.year || ''} • ★ ${item.rating || 'N/A'}</p>
            </div>
         </div>`;
      }).join('') + `<div class="suggest-footer" onclick="Search.triggerFull('${esc(q)}')">See all results for "${esc(q)}"</div>`;
      sug.classList.add('active');
   }

   async function doSearch() {
      const q = State.get('searchQuery');
      if (!q) return;
      showResultsPanel(`Results for "<span>${esc(q)}</span>"`);
      const grid = document.getElementById('searchResultsGrid');
      if (State.get('searchPage') === 1 && grid) grid.innerHTML = '<div class="results-loading"><div class="detail-spinner"></div></div>';
      const data = await TMDB.fetch('/search/multi', { query: q, page: State.get('searchPage') });
      const results = (data?.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
      if (!results.length && State.get('searchPage') === 1) {
         if (grid) grid.innerHTML = `<div class="no-results"><i class="fas fa-search"></i><p>No results for "${esc(q)}"</p><p class="no-results-hint">Try a different spelling or search term.</p></div>`;
         return;
      }
      const cards = results.map(r => gridCard(norm(r, r.media_type))).join('');
      if (State.get('searchPage') === 1 && grid) grid.innerHTML = cards;
      else grid?.insertAdjacentHTML('beforeend', cards);
      const lmBtn = document.getElementById('loadMoreBtn');
      if (lmBtn) lmBtn.style.display = data && data.page < data.total_pages ? 'flex' : 'none';
   }

   function triggerFull(q) {
      document.getElementById('searchInput').value = q;
      State.set('searchQuery', q); State.set('searchPage', 1);
      _saveRecentSearch(q);
      hideSugg();
      doSearch();
   }

   return {
      open, close, toggle, onKeydown, doSearch, hideSuggestions: hideSugg, triggerFull,
      _removeRecent(q) { AppState.recentSearches = AppState.recentSearches.filter(r => r !== q); SafeStorage.set('bb_recent_searches', AppState.recentSearches); _showRecentSearches(); },
      _clearRecent() { AppState.recentSearches = []; SafeStorage.set('bb_recent_searches', []); hideSugg(); },
   };
})();
window.Search = Search;


/* ── GRID CARD ──────────────────────────────────────────────────────────────── */
function gridCard(item) {
   if (!item) return '';
   const q = qualityLabel({ vote_average: item.rating, vote_count: item.votes, release_date: item.year+'-01-01' }, item.type);
   return `<article class="grid-card" onclick="openDetailModal('${esc(item.id)}','${item.type}',false)" tabindex="0" role="button" aria-label="${esc(item.title)}">
      ${item.poster
         ? `<img src="${item.poster}" loading="lazy" alt="${esc(item.title)}" decoding="async">`
         : `<div class="grid-card-no-img"><i class="fas fa-film"></i></div>`}
      <div class="grid-card-body">
         <p class="grid-card-title">${esc(item.title)}</p>
         <div class="grid-card-meta">
            <span class="match">${matchPct(item.rating)}%</span>
            <span>${item.year || ''}</span>
            <span class="type-badge">${item.type.toUpperCase()}</span>
            <span class="media-quality ${q.cls}" style="font-size:.6rem;padding:1px 5px">${q.label}</span>
         </div>
      </div>
   </article>`;
}

function showResultsPanel(title) {
   document.getElementById('pageHome').style.display = 'none';
   document.getElementById('pageResults')?.classList.add('active');
   const titleEl = document.getElementById('resultsTitle');
   if (titleEl) titleEl.innerHTML = title;
   window.scrollTo({ top: 0, behavior: 'smooth' });
   updateActiveNav('');
}

function goHome() {
   document.getElementById('pageHome').style.display = '';
   document.getElementById('pageResults')?.classList.remove('active');
   document.getElementById('searchInput').value = '';
   State.set('searchQuery', ''); State.set('currentCategory', ''); State.set('currentGenreId', null);
   updateActiveNav('nav-home');
   window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ── CATEGORY / GENRE BROWSE ────────────────────────────────────────────────── */
async function showCategory(type, cat) {
   State.set('currentCategoryType', type); State.set('currentCategory', cat); State.set('currentGenreId', null); State.set('filterPage', 1);
   showResultsPanel(`${type==='movie'?'Movies':'TV Shows'} — ${cat.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}`);
   const grid = document.getElementById('searchResultsGrid');
   grid.innerHTML = '<div class="results-loading"><div class="detail-spinner"></div></div>';
   const data = await TMDB.fetch(`/${type}/${cat}`, { page: 1 });
   if (!data?.results) { grid.innerHTML = '<p class="no-results">Failed to load</p>'; return; }
   grid.innerHTML = data.results.map(i => gridCard(norm(i, type))).join('');
   const lmBtn = document.getElementById('loadMoreBtn');
   if (lmBtn) lmBtn.style.display = data.page < data.total_pages ? 'flex' : 'none';
   updateActiveNav('');
}

async function filterByGenre(gid, gname) {
   if (!gid) return;
   State.set('currentGenreId', gid); State.set('currentCategoryType', 'movie'); State.set('currentCategory', ''); State.set('filterPage', 1);
   showResultsPanel(`<i class="fas fa-film"></i> ${esc(gname)}`);
   const grid = document.getElementById('searchResultsGrid');
   grid.innerHTML = '<div class="results-loading"><div class="detail-spinner"></div></div>';
   const data = await TMDB.fetch('/discover/movie', { with_genres: gid, page: 1, sort_by: 'popularity.desc' });
   if (!data?.results) { grid.innerHTML = '<p class="no-results">Failed to load</p>'; return; }
   grid.innerHTML = data.results.map(i => gridCard(norm(i, 'movie'))).join('');
   const lmBtn = document.getElementById('loadMoreBtn');
   if (lmBtn) lmBtn.style.display = data.page < data.total_pages ? 'flex' : 'none';
}

async function loadMore() {
   if (State.get('isFetchingMore')) return;
   State.set('isFetchingMore', true);
   const lmBtn = document.getElementById('loadMoreBtn');
   if (lmBtn) lmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…';
   const q = State.get('searchQuery'), cat = State.get('currentCategory'), gid = State.get('currentGenreId'), type = State.get('currentCategoryType');
   const page = State.get('filterPage') + 1; State.set('filterPage', page);
   const grid = document.getElementById('searchResultsGrid');
   let data;
   try {
      if (q) { State.set('searchPage', State.get('searchPage') + 1); data = await TMDB.fetch('/search/multi', { query: q, page: State.get('searchPage') }); grid.insertAdjacentHTML('beforeend', (data?.results||[]).filter(r=>r.media_type==='movie'||r.media_type==='tv').map(r=>gridCard(norm(r,r.media_type))).join('')); }
      else if (gid) { data = await TMDB.fetch('/discover/movie', { with_genres: gid, page, sort_by: 'popularity.desc' }); grid.insertAdjacentHTML('beforeend', (data?.results||[]).map(i=>gridCard(norm(i,'movie'))).join('')); }
      else if (cat) { data = await TMDB.fetch(`/${type}/${cat}`, { page }); grid.insertAdjacentHTML('beforeend', (data?.results||[]).map(i=>gridCard(norm(i,type))).join('')); }
   } finally {
      if (lmBtn) { lmBtn.innerHTML = 'Load More'; lmBtn.style.display = data && data.page < data.total_pages ? 'flex' : 'none'; }
      State.set('isFetchingMore', false);
   }
}

function updateActiveNav(id) {
   document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
   if (id) document.getElementById(id)?.classList.add('active');
}


/* ── WISHLIST & HISTORY v2 ─────────────────────────────────────────────────── */
function toggleWishlist(id, type, title, poster, year) {
   const wishlist = State.get('wishlist');
   const idx = wishlist.findIndex(w => w.id === String(id));
   let added;
   if (idx > -1) {
      wishlist.splice(idx, 1); added = false;
      showToast(`Removed "${title}" from My List`, 'info');
   } else {
      wishlist.unshift({ id: String(id), type, title, poster, year, addedAt: Date.now(), notes: '' });
      added = true;
      showToast(`Added "${title}" to My List`);
      Achievements.check();
   }
   State.set('wishlist', wishlist); State.persist(); refreshWishlistUI();
   /* Update detail modal button */
   const db = document.getElementById('detailListBtn');
   if (db && State.get('currentId') === String(id)) {
      db.classList.toggle('in-list', added);
      const icon = db.querySelector('i');
      if (icon) { icon.className = `fas ${added?'fa-check':'fa-plus'}`; }
   }
   EventBus.emit('wishlist:changed', { id, added });
}

function refreshWishlistUI() {
   const list = document.getElementById('wishlistItems');
   const empty = document.getElementById('wishlistEmpty');
   const wl = State.get('wishlist');
   if (!list) return;
   if (!wl.length) { list.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
   if (empty) empty.style.display = 'none';
   list.innerHTML = wl.map(item => `
      <div class="wishlist-item" onclick="closeWishlistPanel();openDetailModal('${item.id}','${item.type}',false)">
         ${item.poster ? `<img class="wishlist-poster" src="${item.poster}" loading="lazy">` : '<div class="wishlist-poster wishlist-poster-empty"><i class="fas fa-film"></i></div>'}
         <div class="wishlist-info">
            <p class="wishlist-title">${esc(item.title)}</p>
            <p class="wishlist-meta">${item.type.toUpperCase()} • ${item.year || ''}</p>
            <p class="wishlist-added">${relTime(item.addedAt)}</p>
         </div>
         <div class="wishlist-actions">
            <button class="wl-play-btn" onclick="event.stopPropagation();closeWishlistPanel();openDetailModal('${item.id}','${item.type}',true)" aria-label="Play"><i class="fas fa-play"></i></button>
            <button class="wl-remove-btn" onclick="event.stopPropagation();toggleWishlist('${item.id}','${item.type}','${esc(item.title)}','${item.poster||''}','${item.year||''}')" aria-label="Remove"><i class="fas fa-trash"></i></button>
         </div>
      </div>`).join('');
}

function toggleWishlistPanel() { const p = document.getElementById('wishlistPanel'); p?.classList.contains('open') ? closeWishlistPanel() : openWishlistPanel(); }
function openWishlistPanel()  { refreshWishlistUI(); document.getElementById('wishlistPanel')?.classList.add('open'); refreshHistoryUI(); }
function closeWishlistPanel() { document.getElementById('wishlistPanel')?.classList.remove('open'); }

function switchPanelTab(tab, btn) {
   document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
   if (btn) btn.classList.add('active');
   document.getElementById('panelWishlist').style.display = tab === 'wishlist' ? '' : 'none';
   document.getElementById('panelHistory').style.display  = tab === 'history'  ? '' : 'none';
   if (tab === 'history') refreshHistoryUI();
}

function addToHistory(id, type, title, poster, year) {
   const hist = State.get('watchHistory').filter(h => h.id !== String(id));
   hist.unshift({ id: String(id), type, title, poster, year, watchedAt: Date.now() });
   State.set('watchHistory', hist.slice(0, 150));
   State.persist();
   refreshHistoryUI();
   renderHomeHistory();
}

function refreshHistoryUI() {
   const list = document.getElementById('historyItems');
   const hist = State.get('watchHistory');
   if (!list) return;
   if (!hist.length) { list.innerHTML = '<p class="history-empty">No watch history yet.</p>'; return; }
   list.innerHTML = hist.slice(0, 30).map(item => `
      <div class="history-item" onclick="closeWishlistPanel();openDetailModal('${item.id}','${item.type}',false)">
         ${item.poster ? `<img class="history-poster" src="${item.poster}" loading="lazy">` : ''}
         <div>
            <p class="history-title">${esc(item.title)}</p>
            <p class="history-meta">${item.type.toUpperCase()} • ${relTime(item.watchedAt)}</p>
         </div>
         <button class="history-remove-btn" onclick="event.stopPropagation();_removeHistory('${item.id}')" aria-label="Remove"><i class="fas fa-times"></i></button>
      </div>`).join('');
}

function _removeHistory(id) {
   State.set('watchHistory', State.get('watchHistory').filter(h => h.id !== String(id)));
   State.persist(); refreshHistoryUI(); renderHomeHistory();
}

function renderHomeHistory() {
   const hist = State.get('watchHistory');
   const sec = document.getElementById('historySection');
   const row = document.getElementById('homeHistoryRow');
   if (!sec || !row) return;
   if (!hist.length) { sec.style.display = 'none'; return; }
   sec.style.display = '';
   row.innerHTML = hist.slice(0, 12).map(item => `
      <div onclick="openDetailModal('${item.id}','${item.type}',false)" class="home-history-card">
         ${item.poster ? `<img src="${item.poster}" alt="${esc(item.title)}">` : '<div class="home-history-placeholder"><i class="fas fa-film"></i></div>'}
         <div class="home-history-overlay"><p>${esc(item.title)}</p></div>
      </div>`).join('');
}

function scrollToHistory() { document.getElementById('historySection')?.scrollIntoView({ behavior: 'smooth' }); }


/* ── SHARE MEDIA ────────────────────────────────────────────────────────────── */
async function shareMedia(title, id, type) {
   const url = `${window.location.origin}${window.location.pathname}#${type}/${id}`;
   if (navigator.share) {
      try { await navigator.share({ title: `Watch ${title} on BingeBox`, url }); return; } catch (_) {}
   }
   navigator.clipboard?.writeText(url).then(() => showToast('Link copied to clipboard!', 'success'));
}


/* ── STATS TRACKING ─────────────────────────────────────────────────────────── */
function _trackStats(type, genres) {
   const stats = AppState.stats;
   if (type === 'movie') stats.movies++;
   else stats.episodes++;

   /* Weekly activity heatmap (0=Sun) */
   const day = new Date().getDay();
   if (!Array.isArray(stats.weeklyActivity)) stats.weeklyActivity = Array(7).fill(0);
   stats.weeklyActivity[day] = (stats.weeklyActivity[day] || 0) + 1;

   /* Genre tracking */
   genres.forEach(g => { stats.topGenres[g.name] = (stats.topGenres[g.name] || 0) + 1; });

   /* Streak */
   const today = new Date().toDateString();
   const last = stats.lastWatchDate;
   if (last === today) {
      /* same day — no change */
   } else if (last === new Date(Date.now() - 86400000).toDateString()) {
      stats.streak = (stats.streak || 0) + 1;
      stats.longestStreak = Math.max(stats.longestStreak || 0, stats.streak);
   } else {
      stats.streak = 1;
   }
   stats.lastWatchDate = today;

   SafeStorage.set('bb_stats', stats);
   Achievements.check();
}


/* ── ACHIEVEMENTS SYSTEM ────────────────────────────────────────────────────── */
const Achievements = {
   check() {
      const stats = AppState.stats;
      const wl = State.get('wishlist');
      ACHIEVEMENTS_DEF.forEach(def => {
         if (AppState.achievements[def.id]) return;
         try {
            if (def.req(stats, wl)) {
               AppState.achievements[def.id] = { unlockedAt: Date.now() };
               SafeStorage.set('bb_achievements', AppState.achievements);
               this._notify(def);
            }
         } catch (_) {}
      });
   },

   _notify(def) {
      const rarityColors = { common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
      const color = rarityColors[def.rarity] || '#fff';
      const t = document.getElementById('toast');
      if (!t) return;
      t.className = 'toast show achievement-toast';
      t.style.borderColor = color;
      t.innerHTML = `<span class="achievement-icon">${def.icon}</span><div><strong>Achievement Unlocked!</strong><br><span style="color:${color}">${def.name}</span> — ${def.desc}</div>`;
      clearTimeout(t._timer);
      t._timer = setTimeout(() => t.classList.remove('show'), 5000);
      vibrate('heavy');
   },

   getAll() {
      return ACHIEVEMENTS_DEF.map(def => ({ ...def, unlocked: !!AppState.achievements[def.id], unlockedAt: AppState.achievements[def.id]?.unlockedAt || null }));
   },

   renderPanel() {
      const container = document.getElementById('achievementsGrid');
      if (!container) return;
      const all = this.getAll();
      const rarityOrder = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
      all.sort((a, b) => (a.unlocked === b.unlocked ? rarityOrder[a.rarity] - rarityOrder[b.rarity] : a.unlocked ? -1 : 1));
      container.innerHTML = all.map(a => `
         <div class="achievement-card ${a.unlocked ? 'unlocked' : 'locked'} rarity-${a.rarity}">
            <div class="achievement-icon-wrap">${a.icon}</div>
            <div class="achievement-info">
               <p class="achievement-name">${a.unlocked ? a.name : '???'}</p>
               <p class="achievement-desc">${a.unlocked ? a.desc : 'Keep watching to unlock'}</p>
               <span class="achievement-rarity">${a.rarity}</span>
            </div>
            ${a.unlocked ? `<div class="achievement-check"><i class="fas fa-check-circle"></i></div>` : '<div class="achievement-lock"><i class="fas fa-lock"></i></div>'}
         </div>`).join('');
   },
};


/* ── SETTINGS ENGINE v2 ─────────────────────────────────────────────────────── */
function openSettings(tab = 'appearance') {
   const modal = document.getElementById('settingsModal');
   if (!modal) return;
   refreshSettingsUI();
   switchSettingsTab(tab, document.querySelector(`.set-tab-btn[data-tab="${tab}"]`) || document.querySelector('.set-tab-btn'));
   modal.classList.add('active');
}
function closeSettings() { document.getElementById('settingsModal')?.classList.remove('active'); }

function switchSettingsTab(tab, btn) {
   document.querySelectorAll('.set-tab').forEach(el => el.classList.remove('active'));
   document.querySelectorAll('.set-tab-btn').forEach(el => el.classList.remove('active'));
   document.getElementById(`set-tab-${tab}`)?.classList.add('active');
   if (btn) btn.classList.add('active');
   if (tab === 'data') renderStatsChart();
   if (tab === 'achievements') Achievements.renderPanel();
}

function refreshSettingsUI() {
   const s = AppState.settings;
   ['ambientGlow','cinemaDim','privacyMode','bandwidthSaver','autoPlayNext','showCastSection','reducedMotion','notificationsEnabled','autoTheme']
      .forEach(k => document.getElementById(`tog-${k}`)?.classList.toggle('on', !!s[k]));
   document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === s.theme));
   const hapticEl = document.getElementById('set-haptic');
   if (hapticEl) hapticEl.value = s.hapticIntensity || 50;
   const srvEl = document.getElementById('set-server');
   if (srvEl) srvEl.innerHTML = SERVERS.map((srv, i) => `<option value="${i}" ${State.get('currentServer')===i?'selected':''}>${srv.badge} ${srv.name}</option>`).join('');
   /* Stats summary */
   const stats = AppState.stats;
   const summaryEl = document.getElementById('statsSummaryText');
   if (summaryEl) summaryEl.innerHTML = `<strong>${stats.movies}</strong> movies • <strong>${stats.episodes}</strong> episodes • <strong>${(stats.hoursWatched||0).toFixed(1)}h</strong> watched • <strong>${stats.streak||0}</strong> day streak`;
}

function toggleSetting(key) {
   AppState.settings[key] = !AppState.settings[key];
   document.getElementById(`tog-${key}`)?.classList.toggle('on', AppState.settings[key]);
   if (key === 'reducedMotion') document.documentElement.classList.toggle('reduced-motion', AppState.settings[key]);
}

function applyTheme(theme, btn) {
   document.documentElement.setAttribute('data-theme', theme);
   AppState.settings.theme = theme;
   document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
   if (btn) btn.classList.add('active');
   showToast(`Theme: ${theme.toUpperCase()}`);
}

function testHaptic() {
   AppState.settings.hapticIntensity = parseInt(document.getElementById('set-haptic')?.value || 50);
   vibrate('heavy');
   showToast(`Haptic: ${AppState.settings.hapticIntensity}%`, 'info');
}

function saveSettings() {
   const srvEl = document.getElementById('set-server');
   if (srvEl) State.set('currentServer', parseInt(srvEl.value));
   const tkEl = document.getElementById('set-tmdb');
   if (tkEl?.value.trim()) { CONFIG.TMDB_KEY = tkEl.value.trim(); SafeStorage.set('bb_tmdb_key', CONFIG.TMDB_KEY); TMDB.clearCache(); }
   if (AppState.settings.autoTheme) _autoTheme();
   SafeStorage.set('bb_settings', AppState.settings);
   closeSettings();
   showToast('Settings saved.', 'success');
}

function _autoTheme() {
   const h = new Date().getHours();
   const theme = h >= 6 && h < 20 ? 'netflix' : 'midnight';
   applyTheme(theme, null);
}

function renderStatsChart() {
   setTimeout(() => {
      const ctx = document.getElementById('statsChart');
      if (!ctx || !window.Chart) return;
      if (window._statsChart) window._statsChart.destroy();
      const stats = AppState.stats;
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const weekly = Array.isArray(stats.weeklyActivity) ? stats.weeklyActivity : Array(7).fill(0);
      window._statsChart = new Chart(ctx, {
         type: 'bar',
         data: {
            labels: days,
            datasets: [{
               label: 'Activity',
               data: weekly,
               backgroundColor: weekly.map((_, i) => i === new Date().getDay() ? 'rgba(229,9,20,.85)' : 'rgba(255,255,255,.15)'),
               borderColor: weekly.map((_, i) => i === new Date().getDay() ? '#E50914' : 'rgba(255,255,255,.3)'),
               borderWidth: 1, borderRadius: 6,
            }]
         },
         options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
               y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#888', stepSize: 1 } },
               x: { grid: { display: false }, ticks: { color: '#888' } }
            },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} watch${ctx.raw !== 1 ? 'es' : ''}` } } }
         }
      });

      /* Genre donut chart if data exists */
      const gCtx = document.getElementById('genreChart');
      if (gCtx && Object.keys(stats.topGenres || {}).length) {
         if (window._genreChart) window._genreChart.destroy();
         const genres = Object.entries(stats.topGenres).sort((a, b) => b[1] - a[1]).slice(0, 6);
         const palette = ['#E50914','#3b82f6','#22c55e','#f59e0b','#a855f7','#06b6d4'];
         window._genreChart = new Chart(gCtx, {
            type: 'doughnut',
            data: { labels: genres.map(g => g[0]), datasets: [{ data: genres.map(g => g[1]), backgroundColor: palette, borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#ccc', font: { size: 11 } } } } }
         });
      }
   }, 80);
}

function exportData() { SafeStorage.export(); }
function importData(file) { SafeStorage.import(file); }
function clearAllData() {
   if (!confirm('Clear ALL watch history, lists, stats, and settings? This is permanent.')) return;
   ['bb_lib','bb_stats','bb_wishlist','bb_history','bb_achievements','bb_ep_progress','bb_continue','bb_notifs','bb_recent_searches'].forEach(k => localStorage.removeItem(k));
   showToast('All data cleared. Reloading…', 'warning');
   setTimeout(() => location.reload(), 1500);
}


/* ── CONTEXT MENU ───────────────────────────────────────────────────────────── */
function showContextMenu(e, id, type, data) {
   e.preventDefault(); vibrate('light');
   const cm = document.getElementById('context-menu');
   if (!cm) return;
   cm.style.display = 'block';
   cm.style.left = `${Math.min(e.pageX, window.innerWidth - 240)}px`;
   cm.style.top  = `${Math.min(e.pageY, window.innerHeight - 220)}px`;
   const item = (() => { try { return JSON.parse(decodeURIComponent(data)); } catch { return {}; } })();
   const title = item.title || item.name || '';
   const poster = item.poster_path ? `${CONFIG.IMG_W500}${item.poster_path}` : '';
   const year = (item.release_date || item.first_air_date || '').slice(0, 4);
   cm.querySelector('#cm-play')?.addEventListener('click', () => { cm.style.display = 'none'; openDetailModal(id, type, true); }, { once: true });
   cm.querySelector('#cm-watchlist')?.addEventListener('click', () => { cm.style.display = 'none'; toggleWishlist(id, type, title, poster, year); }, { once: true });
   cm.querySelector('#cm-share')?.addEventListener('click', () => { cm.style.display = 'none'; shareMedia(title, id, type); }, { once: true });
   cm.querySelector('#cm-info')?.addEventListener('click', () => { cm.style.display = 'none'; openDetailModal(id, type, false); }, { once: true });
}


/* ── GENRE PILLS ────────────────────────────────────────────────────────────── */
function buildGenrePills() {
   const genres = [
      {id:28,name:'Action'},{id:35,name:'Comedy'},{id:27,name:'Horror'},{id:878,name:'Sci-Fi'},
      {id:10749,name:'Romance'},{id:53,name:'Thriller'},{id:16,name:'Animation'},{id:99,name:'Documentary'},
      {id:18,name:'Drama'},{id:10765,name:'Fantasy'},{id:9648,name:'Mystery'},{id:80,name:'Crime'},
      {id:36,name:'History'},{id:10752,name:'War'},{id:37,name:'Western'},
   ];
   const bar = document.getElementById('genrePillsBar');
   if (bar) bar.innerHTML = genres.map(g => `<button class="genre-pill-btn" onclick="filterByGenre(${g.id},'${esc(g.name)}')">${esc(g.name)}</button>`).join('');
   const dd = document.getElementById('genreDropdown');
   if (dd) dd.innerHTML = genres.map(g => `<div class="genre-drop-item" onclick="filterByGenre(${g.id},'${esc(g.name)}')">${esc(g.name)}</div>`).join('');
}


/* ── INFINITE SCROLL ─────────────────────────────────────────────────────────── */
function setupInfiniteScroll() {
   const sentinel = document.getElementById('infiniteScrollSentinel');
   if (!sentinel) return;
   new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && State.get('infiniteScrollOn') && !State.get('isFetchingMore')) loadMore();
   }, { rootMargin: '300px' }).observe(sentinel);
}

function toggleInfiniteScroll() {
   const on = State.toggle('infiniteScrollOn');
   const btn = document.getElementById('infiniteScrollBtn');
   if (btn) { btn.textContent = on ? '⚡ Auto-Load: ON' : '🔄 Auto-Load: OFF'; btn.classList.toggle('active', on); }
   showToast(on ? 'Auto-load enabled' : 'Auto-load disabled', 'info');
}


/* ── VOICE SEARCH ───────────────────────────────────────────────────────────── */
function startVoiceSearch() {
   const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
   if (!SR) { showToast('Voice search not supported in this browser.', 'error'); return; }
   const rec = new SR();
   rec.lang = AppState.settings.language || 'en-US';
   rec.interimResults = false;
   rec.maxAlternatives = 1;
   rec.onstart = () => { showToast('🎙️ Listening…', 'info'); vibrate('medium'); };
   rec.onresult = e => {
      const txt = e.results[0][0].transcript.trim();
      showToast(`Searching: "${txt}"`, 'info');
      State.set('searchQuery', txt);
      const inp = document.getElementById('searchInput');
      if (inp) inp.value = txt;
      Search.open();
      Search.doSearch();
   };
   rec.onerror = err => showToast(`Voice error: ${err.error}`, 'error');
   rec.start();
}


/* ── KONAMI CODE ────────────────────────────────────────────────────────────── */
function activateKonami() {
   AppState._konami = true;
   document.documentElement.setAttribute('data-theme', 'godmode');
   AppState.settings.theme = 'godmode';
   SafeStorage.set('bb_settings', AppState.settings);
   showToast('⚡ GOD MODE UNLOCKED — You found the secret!', 'success', 5000);
   vibrate('heavy');
   Achievements.check();
   /* Visual burst */
   const burst = document.createElement('div');
   burst.id = 'konamiBurst';
   burst.innerHTML = Array.from({length:20},()=>`<div class="konami-particle" style="--dx:${(Math.random()-0.5)*400}px;--dy:${(Math.random()-0.5)*400}px;--r:${Math.random()*720}deg"></div>`).join('');
   document.body.appendChild(burst);
   setTimeout(() => burst.remove(), 2000);
}


/* ── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────────── */
function showKeyboardShortcuts() {
   const shortcuts = [
      { key: '/', action: 'Open Search' },
      { key: 'Esc', action: 'Close modal / Search' },
      { key: 'F', action: 'Toggle Cinema Mode' },
      { key: 'M', action: 'Toggle My List panel' },
      { key: 'H', action: 'Go Home' },
      { key: 'S', action: 'Open Settings' },
      { key: 'N', action: 'Next episode (in player)' },
      { key: 'ArrowLeft / Right', action: 'Hero carousel' },
      { key: '↑↑↓↓←→←→BA', action: '🕹️ Konami Code' },
   ];
   const existing = document.getElementById('shortcutsModal');
   if (existing) { existing.remove(); return; }
   const modal = document.createElement('div');
   modal.id = 'shortcutsModal';
   modal.className = 'shortcuts-modal';
   modal.innerHTML = `
      <div class="shortcuts-box">
         <div class="shortcuts-header"><h3>⌨️ Keyboard Shortcuts</h3><button onclick="this.closest('#shortcutsModal').remove()"><i class="fas fa-times"></i></button></div>
         <div class="shortcuts-list">
            ${shortcuts.map(s => `<div class="shortcut-row"><kbd>${esc(s.key)}</kbd><span>${esc(s.action)}</span></div>`).join('')}
         </div>
      </div>`;
   modal.onclick = e => { if (e.target === modal) modal.remove(); };
   document.body.appendChild(modal);
}


/* ── BOOT SEQUENCE ──────────────────────────────────────────────────────────── */
async function init() {
   /* Apply theme immediately */
   document.documentElement.setAttribute('data-theme', AppState.settings.theme || 'netflix');
   if (AppState.settings.reducedMotion) document.documentElement.classList.add('reduced-motion');
   if (AppState.settings.autoTheme) _autoTheme();

   const hideLoader = () => { document.getElementById('loaderOverlay')?.classList.add('hidden'); };
   const failsafe = setTimeout(hideLoader, 3000);

   try {
      /* Boot profile screen first */
      showProfiles();

      /* Parallel load: genres + hero */
      const [genreMovies, genreTV] = await Promise.all([
         TMDB.fetch('/genre/movie/list', {}, CONFIG.CACHE_TTL_LONG),
         TMDB.fetch('/genre/tv/list',    {}, CONFIG.CACHE_TTL_LONG),
      ]);
      if (genreMovies || genreTV) {
         [...(genreMovies?.genres || []), ...(genreTV?.genres || [])].forEach(g => { GENRE_MAP[g.id] = g.name; });
         buildGenrePills();
      }

      /* Build UI systems */
      Hero.load();
      Rows.buildAll();
      refreshWishlistUI();
      refreshHistoryUI();
      renderHomeHistory();
      setupInfiniteScroll();
      Navbar.init();
      PartyEngine.renderReactionBar?.();
      Achievements.check();

      /* Keyboard listeners */
      document.addEventListener('keydown', e => {
         /* Konami */
         if (e.key === AppState.konamiCode[AppState.konamiIndex]) {
            AppState.konamiIndex++;
            if (AppState.konamiIndex === AppState.konamiCode.length) { activateKonami(); AppState.konamiIndex = 0; }
         } else { AppState.konamiIndex = 0; }

         /* Skip shortcuts inside text inputs */
         const tag = document.activeElement?.tagName;
         const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
         if (!inInput) {
            if (e.key === '/') { e.preventDefault(); Search.open(); }
            if (e.key === 'f' || e.key === 'F') { if (document.getElementById('playerSection')?.style.display !== 'none') goFullscreen(); }
            if (e.key === 'm' || e.key === 'M') toggleWishlistPanel();
            if (e.key === 'h' || e.key === 'H') goHome();
            if (e.key === 's' || e.key === 'S') openSettings();
            if (e.key === 'n' || e.key === 'N') { if (State.get('currentType') === 'tv') nextEpisode(); }
            if (e.key === '?') showKeyboardShortcuts();
            if (e.key === 'ArrowLeft')  { Hero.prev(); Hero.restartCycle(); }
            if (e.key === 'ArrowRight') { Hero.next(); Hero.restartCycle(); }
         }
         if (e.key === 'Escape') {
            closeDetailModal();
            closeSettings();
            closeWishlistPanel();
            Search.close();
            document.getElementById('partyModal').style.display = 'none';
            document.getElementById('serverPickerDropdown').style.display = 'none';
            document.getElementById('shortcutsModal')?.remove();
         }
      });

      /* Back button handling */
      window.addEventListener('popstate', e => { if (!e.state || e.state.view !== 'modal') closeDetailModal(); });

      /* Deep-link handler: #type/id */
      const hash = window.location.hash.slice(1);
      if (/^(movie|tv)\/\d+$/.test(hash)) {
         const [type, id] = hash.split('/');
         EventBus.once('profile:selected', () => openDetailModal(id, type, false));
      }

      /* Periodic streak check */
      setInterval(Achievements.check.bind(Achievements), 60000);

   } catch (err) {
      console.error('[BingeBox] Init error:', err);
   } finally {
      clearTimeout(failsafe);
      hideLoader();
   }
}


/* ── GLOBAL FUNCTION EXPORTS ────────────────────────────────────────────────── */
Object.assign(window, {
   openDetailModal, closeDetailModal, startPlaying, switchServer, switchServerTo, openServerPicker,
   loadEpisodes, playEpisode, nextEpisode, goFullscreen,
   toggleWishlist, toggleWishlistPanel, openWishlistPanel, closeWishlistPanel, switchPanelTab,
   showCategory, filterByGenre, goHome, loadMore, toggleInfiniteScroll,
   showToast, updateActiveNav, showContextMenu, buildGenrePills,
   openSettings, closeSettings, switchSettingsTab, toggleSetting, applyTheme,
   saveSettings, exportData, importData, clearAllData, testHaptic,
   showProfiles, selectProfile, promptAddProfile,
   startVoiceSearch, activateKonami, scrollToHistory, shareMedia,
   showKeyboardShortcuts,
   PartyEngine, Navbar, Hero, Rows, Search, Achievements, TMDB, EventBus, State, AppState,
});

/* ── LAUNCH ─────────────────────────────────────────────────────────────────── */
init();
