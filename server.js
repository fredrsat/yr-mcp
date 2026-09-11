#!/usr/bin/env node
// MCP-server for Yr / MET Norway sitt åpne vær-API.
// Datakilder: api.met.no (Locationforecast 2.0, Nowcast 2.0) og www.yr.no stedssøk.
// MET krever identifiserende User-Agent og maks 4 desimaler i koordinater.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const USER_AGENT = "yr-mcp/1.0 https://github.com/fredrsat/yr-mcp";
const DEFAULT_TZ = "Europe/Oslo";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fra ${url}`);
  return res.json();
}

const round4 = (n) => Math.round(n * 10000) / 10000;

async function searchLocations(query, limit = 5) {
  const url = `https://www.yr.no/api/v0/locations/search?q=${encodeURIComponent(query)}&language=nb`;
  const data = await fetchJson(url);
  const hits = data._embedded?.location ?? [];
  return hits.slice(0, limit).map((l) => ({
    id: l.id,
    name: l.name,
    category: l.category?.name,
    region: [l.subregion?.name, l.region?.name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", "),
    country: l.country?.name,
    lat: l.position.lat,
    lon: l.position.lon,
    elevation: l.elevation,
    timeZone: l.timeZone,
  }));
}

// Slår opp sted hvis navn er gitt, ellers brukes lat/lon direkte.
async function resolvePlace({ place, lat, lon }) {
  if (place) {
    const hits = await searchLocations(place, 1);
    if (hits.length === 0) throw new Error(`Fant ikke stedet «${place}»`);
    return hits[0];
  }
  if (lat == null || lon == null) throw new Error("Oppgi enten place eller lat+lon");
  return { name: `${lat},${lon}`, lat, lon, timeZone: DEFAULT_TZ };
}

function localParts(isoTime, timeZone) {
  const d = new Date(isoTime);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const s = fmt.format(d); // "2026-09-11 18:00"
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

function formatForecast(met, loc, hours) {
  const tz = loc.timeZone || DEFAULT_TZ;
  const series = met.properties.timeseries;
  const lines = [];
  const header = loc.region
    ? `${loc.name} (${loc.region}, ${loc.country})`
    : loc.name;
  lines.push(`Værvarsel for ${header} — lat ${loc.lat}, lon ${loc.lon}. Tider i ${tz}.`);
  lines.push(`Oppdatert: ${met.properties.meta.updated_at}`);

  // Time-for-time de neste `hours` timene
  lines.push("", `Time for time (neste ${hours} t):`);
  const now = Date.now();
  const hourly = series
    .filter((t) => new Date(t.time).getTime() >= now - 3600_000)
    .filter((t) => t.data.next_1_hours)
    .slice(0, hours);
  for (const t of hourly) {
    const { date, time } = localParts(t.time, tz);
    const d = t.data.instant.details;
    const n1 = t.data.next_1_hours;
    const precip = n1.details?.precipitation_amount ?? 0;
    lines.push(
      `${date} ${time}  ${String(d.air_temperature).padStart(5)}°C  ` +
      `vind ${d.wind_speed} m/s  nedbør ${precip} mm  ${n1.summary.symbol_code}`
    );
  }

  // Dagsoppsummering for hele varselsperioden
  const days = new Map();
  for (const t of series) {
    const { date } = localParts(t.time, tz);
    if (!days.has(date)) days.set(date, { temps: [], winds: [], p1: 0, has1: false, p6: 0, symbols: [] });
    const day = days.get(date);
    const d = t.data.instant?.details;
    if (d?.air_temperature != null) day.temps.push(d.air_temperature);
    if (d?.wind_speed != null) day.winds.push(d.wind_speed);
    if (t.data.next_1_hours) {
      day.p1 += t.data.next_1_hours.details?.precipitation_amount ?? 0;
      day.has1 = true;
    } else if (t.data.next_6_hours) {
      day.p6 += t.data.next_6_hours.details?.precipitation_amount ?? 0;
    }
    const sym = t.data.next_6_hours?.summary?.symbol_code ?? t.data.next_1_hours?.summary?.symbol_code;
    if (sym) day.symbols.push(sym);
  }
  lines.push("", "Dagsoversikt:");
  for (const [date, day] of days) {
    if (day.temps.length === 0) continue;
    const min = Math.min(...day.temps), max = Math.max(...day.temps);
    const wind = Math.max(...day.winds);
    const precip = (day.has1 ? day.p1 : 0) + day.p6;
    // Mest hyppige værsymbol den dagen
    const counts = {};
    for (const s of day.symbols) counts[s] = (counts[s] ?? 0) + 1;
    const symbol = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    lines.push(`${date}  ${min}–${max}°C  nedbør ${precip.toFixed(1)} mm  vind opptil ${wind} m/s  ${symbol}`);
  }
  return lines.join("\n");
}

const server = new McpServer({ name: "yr", version: "1.0.0" });

server.registerTool(
  "search_location",
  {
    title: "Søk etter sted",
    description:
      "Søk etter steder (Yr/MET stedsregister). Returnerer navn, region, koordinater og tidssone. " +
      "Bruk denne hvis et stedsnavn er tvetydig; ellers kan get_forecast ta stedsnavn direkte.",
    inputSchema: {
      query: z.string().describe("Stedsnavn, f.eks. 'Tromsø' eller 'Hemsedal'"),
      limit: z.number().int().min(1).max(20).optional().describe("Maks antall treff (standard 5)"),
    },
  },
  async ({ query, limit }) => {
    const hits = await searchLocations(query, limit ?? 5);
    if (hits.length === 0) return { content: [{ type: "text", text: `Ingen treff på «${query}»` }] };
    const text = hits
      .map((h) => `${h.name} (${h.category ?? "sted"}, ${[h.region, h.country].filter(Boolean).join(", ")}) — lat ${h.lat}, lon ${h.lon}, ${h.elevation ?? "?"} moh, ${h.timeZone}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "get_forecast",
  {
    title: "Hent værvarsel",
    description:
      "Værvarsel fra Yr/MET (Locationforecast 2.0): time-for-time og dagsoversikt (temperatur, vind, nedbør, værsymbol). " +
      "Oppgi enten et stedsnavn (place) eller koordinater (lat + lon). Fungerer for hele verden.",
    inputSchema: {
      place: z.string().optional().describe("Stedsnavn, f.eks. 'Bergen'. Første søketreff brukes."),
      lat: z.number().min(-90).max(90).optional().describe("Breddegrad (alternativ til place)"),
      lon: z.number().min(-180).max(180).optional().describe("Lengdegrad (alternativ til place)"),
      hours: z.number().int().min(1).max(48).optional().describe("Antall timer i time-for-time-visningen (standard 12)"),
    },
  },
  async ({ place, lat, lon, hours }) => {
    const loc = await resolvePlace({ place, lat, lon });
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${round4(loc.lat)}&lon=${round4(loc.lon)}`;
    const met = await fetchJson(url);
    return { content: [{ type: "text", text: formatForecast(met, loc, hours ?? 12) }] };
  }
);

server.registerTool(
  "get_nowcast",
  {
    title: "Nedbør neste 90 minutter",
    description:
      "Nedbørsvarsel minutt for minutt de neste ~90 minuttene (MET Nowcast 2.0). Dekker kun Norden. " +
      "Oppgi stedsnavn (place) eller koordinater (lat + lon).",
    inputSchema: {
      place: z.string().optional().describe("Stedsnavn, f.eks. 'Oslo'"),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
    },
  },
  async ({ place, lat, lon }) => {
    const loc = await resolvePlace({ place, lat, lon });
    const url = `https://api.met.no/weatherapi/nowcast/2.0/complete?lat=${round4(loc.lat)}&lon=${round4(loc.lon)}`;
    let met;
    try {
      met = await fetchJson(url);
    } catch (e) {
      if (String(e).includes("422")) {
        return { content: [{ type: "text", text: `Nowcast dekker ikke ${loc.name} (kun Norden).` }] };
      }
      throw e;
    }
    const tz = loc.timeZone || DEFAULT_TZ;
    const series = met.properties.timeseries;
    const current = series[0]?.data?.instant?.details ?? {};
    const lines = [`Nedbør neste 90 min for ${loc.name} (tider i ${tz}):`];
    if (current.air_temperature != null) {
      lines.push(`Nå: ${current.air_temperature}°C, nedbørsintensitet ${current.precipitation_rate ?? 0} mm/t`);
    }
    for (const t of series) {
      const rate = t.data.instant?.details?.precipitation_rate;
      if (rate == null) continue;
      const { time } = localParts(t.time, tz);
      lines.push(`${time}  ${rate} mm/t${rate > 0 ? "  🌧" : ""}`);
    }
    if (series.every((t) => (t.data.instant?.details?.precipitation_rate ?? 0) === 0)) {
      lines.push("Oppholdsvær hele perioden.");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
