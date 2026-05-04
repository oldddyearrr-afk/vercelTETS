class LRUCache {
  constructor(max) {
    this.max = max;
    this.cache = new Map();
  }
  
  get(k) {
    if (!this.cache.has(k)) return null;
    const v = this.cache.get(k);
    this.cache.delete(k);
    this.cache.set(k, v);
    return v;
  }
  
  set(k, v) {
    if (this.cache.has(k)) {
      this.cache.delete(k);
    } else if (this.cache.size >= this.max) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(k, v);
  }
}

const scache = new LRUCache(50);
const pcache = new LRUCache(50);
const streams = new Map();

streams.set('demo', {
  url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  token_api: null,
  token_ttl: 3600
});

function fullUrl(base, rel) {
  if (!rel || rel.startsWith('http')) return rel;
  if (rel.startsWith('/')) {
    const u = new URL(base);
    return u.origin + rel;
  }
  const u = new URL(base);
  const parts = u.pathname.split('/');
  parts.pop();
  return u.origin + parts.join('/') + '/' + rel;
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const match = path.match(/^\/api\/stream\/([^\/]+?)(?:\.(m3u8|mpd))?$/);
    
    if (match) {
      const id = match[1];
      const fmt = match[2] || 'm3u8';
      const stream = streams.get(id);
      
      if (!stream) {
        return res.status(404).send('Stream not found');
      }
      
      let streamUrl = stream.url;
      
      if (fmt === 'm3u8' && !streamUrl.includes('.m3u8')) {
        streamUrl = streamUrl.endsWith('/') 
          ? streamUrl + 'index.m3u8' 
          : streamUrl + '/index.m3u8';
      }
      
      if (fmt === 'mpd' && !streamUrl.includes('.mpd')) {
        streamUrl = streamUrl.endsWith('/') 
          ? streamUrl + 'manifest.mpd' 
          : streamUrl + '/manifest.mpd';
      }
      
      const cacheKey = `${id}_${fmt}`;
      const cached = pcache.get(cacheKey);
      
      if (cached && (Date.now() - cached.ts) < 2000) {
        res.setHeader('Content-Type', fmt === 'mpd' ? 'application/dash+xml' : 'application/vnd.apple.mpegurl');
        return res.send(cached.data);
      }
      
      const response = await fetch(streamUrl, {
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      
      if (!response.ok) {
        return res.status(response.status).send('Failed to fetch playlist');
      }
      
      let data = await response.text();
      const segBase = `/api/stream/${id}/seg/`;
      
      if (fmt === 'm3u8') {
        data = data.replace(/^(?!#)([^\s]+\.(ts|m4s|mp4|aac|vtt|m4a|webm)[^\s]*)$/gm, (m) => {
          const full = fullUrl(streamUrl, m);
          return segBase + Buffer.from(full).toString('base64');
        });
      } else if (fmt === 'mpd') {
        data = data.replace(/(<SegmentTemplate[^>]*media=")([^"]*)("[^>]*>)/g, (m, p1, u, p2) => {
          const full = fullUrl(streamUrl, u);
          return p1 + segBase + Buffer.from(full).toString('base64') + p2;
        });
      }
      
      pcache.set(cacheKey, { data, ts: Date.now() });
      
      res.setHeader('Content-Type', fmt === 'mpd' ? 'application/dash+xml' : 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'public, max-age=1');
      return res.send(data);
    }
    
    const segMatch = path.match(/^\/api\/stream\/([^\/]+)\/seg\/(.+)$/);
    
    if (segMatch) {
      const id = segMatch[1];
      const enc = segMatch[2];
      const segUrl = Buffer.from(enc, 'base64').toString('utf-8');
      
      const cacheKey = `${id}_${segUrl}`;
      const cached = scache.get(cacheKey);
      
      if (cached) {
        res.setHeader('Content-Type', cached.type || 'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.send(cached.data);
      }
      
      const response = await fetch(segUrl, {
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      
      if (!response.ok) {
        return res.status(response.status).send('Segment not found');
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      
      scache.set(cacheKey, {
        data: buffer,
        type: response.headers.get('content-type') || 'video/mp2t',
        ts: Date.now()
      });
      
      res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.send(buffer);
    }
    
    return res.status(404).send('Not Found');
    
  } catch (e) {
    return res.status(500).send('Internal Error');
  }
    }
