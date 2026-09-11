# yr-mcp

An [MCP](https://modelcontextprotocol.io/) server for weather data from **[Yr](https://www.yr.no/)** / **[MET Norway](https://api.met.no/)** — the Norwegian Meteorological Institute's free, open weather API.

Ask your AI assistant things like *"Will it rain in Bergen this weekend?"* or *"Do I need an umbrella in the next hour?"* and it can answer with real forecast data. Forecasts work worldwide; minute-by-minute precipitation nowcasts cover the Nordic region.

No API key required.

## Tools

| Tool | Description |
|---|---|
| `get_forecast` | Weather forecast (Locationforecast 2.0): hour-by-hour temperature, wind, precipitation and weather symbol, plus a daily summary for the full ~10-day forecast period. Takes a place name or coordinates. Works globally. |
| `get_nowcast` | Minute-by-minute precipitation for the next ~90 minutes (Nowcast 2.0). Nordic region only. |
| `search_location` | Search Yr's location registry. Returns name, region, coordinates, elevation and time zone — useful for disambiguating place names. |

`get_forecast` and `get_nowcast` accept either a `place` name (the top search hit is used) or explicit `lat`/`lon` coordinates. Times are converted to the location's local time zone.

## Installation

Requires [Node.js](https://nodejs.org/) 18 or newer.

```sh
git clone https://github.com/fredrsat/yr-mcp.git
cd yr-mcp
npm install
```

### Claude Code

```sh
claude mcp add --scope user yr -- node /path/to/yr-mcp/server.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "yr": {
      "command": "node",
      "args": ["/path/to/yr-mcp/server.js"]
    }
  }
}
```

Any other MCP client that supports stdio transport works the same way: run `node server.js` and speak MCP over stdin/stdout.

## Example

> **User:** Will it rain in Trondheim tomorrow?
>
> The assistant calls `get_forecast` with `place: "Trondheim"` and answers from the daily summary:
>
> ```
> Dagsoversikt:
> 2026-09-12  12.2–13.8°C  nedbør 7.8 mm  vind opptil 8.9 m/s  cloudy
> ...
> ```

## Data sources and terms of use

- Forecast data: [MET Norway Locationforecast 2.0](https://api.met.no/weatherapi/locationforecast/2.0/documentation) and [Nowcast 2.0](https://api.met.no/weatherapi/nowcast/2.0/documentation), licensed under [NLOD](https://data.norge.no/nlod/en/2.0) / [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Location search: Yr's location registry (`www.yr.no/api/v0/locations`).

The server follows [MET's terms of service](https://api.met.no/doc/TermsOfService): it sends an identifying `User-Agent` header and truncates coordinates to four decimals. If you fork this project, please change the `USER_AGENT` constant in `server.js` to identify your own deployment.

Weather data © [MET Norway](https://www.met.no/).

## License

MIT
