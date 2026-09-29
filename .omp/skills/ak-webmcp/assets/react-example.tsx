// React WebMCP example using the `usewebmcp` hook (package `usewebmcp`, v5.x;
// docs: https://docs.mcp-b.ai/packages/usewebmcp/reference).
//
//   npm install usewebmcp
//
// `usewebmcp` depends on @mcp-b/webmcp-polyfill + @mcp-b/webmcp-types, but the
// polyfill is not automatic: outside a native/OT build, initialize
// @mcp-b/webmcp-polyfill (or @mcp-b/global) before any tool registers.
//
// Hook contract (verified against the package reference):
//   useWebMCP(config, deps?) -> { state, execute, reset }
//   config: { name, description, enabled?, inputSchema?, outputSchema?,
//             annotations?, execute }
//   - execute(input) is SINGLE-arg: (input) => T | Promise<T>
//     (this differs from the native document.modelContext callback, which
//      also receives a second { signal } argument).
//   - there is NO `title` field on the hook config.
//   - use `as const` on inline inputSchema so input types are inferred.
//   - `enabled: false` skips registration; the hook must still be called
//     unconditionally (Rules of Hooks). It unregisters on unmount.

import { useWebMCP } from 'usewebmcp';

type Flight = { id: string; from: string; to: string; price: number };

async function searchFlights(args: { from: string; to: string; date: string }): Promise<Flight[]> {
  const res = await fetch(
    `/api/flights?from=${encodeURIComponent(args.from)}` +
      `&to=${encodeURIComponent(args.to)}&date=${encodeURIComponent(args.date)}`,
  );
  return res.json();
}

// Read-only lookup: safe to call without confirmation.
export function FlightSearchTool() {
  const { state } = useWebMCP({
    name: 'search_flights',
    description: 'Search available flights between two airports on a date.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Origin airport code, e.g. SFO.' },
        to: { type: 'string', description: 'Destination airport code, e.g. JFK.' },
        date: { type: 'string', description: 'Departure date; natural language ok.' },
      },
      required: ['from', 'to', 'date'],
    } as const,
    annotations: { readOnlyHint: true },
    execute: async ({ from, to, date }) => {
      const flights = await searchFlights({ from, to, date });
      // Cap by slicing the ARRAY, not the JSON string (never truncate mid-token).
      return JSON.stringify(flights.slice(0, 10));
    },
  });

  return state.isExecuting ? <span>Searching flights...</span> : null;
}

// A consequential (irreversible) action is annotated so the browser/agent can
// force a user confirmation before executing.
export function BookFlightTool() {
  useWebMCP({
    name: 'book_flight',
    description: 'Book a specific flight for a number of passengers.',
    inputSchema: {
      type: 'object',
      properties: {
        flightId: { type: 'string', description: 'ID of the flight to book.' },
        passengers: { type: 'number', description: 'Number of tickets to purchase.' },
      },
      required: ['flightId', 'passengers'],
    } as const,
    annotations: { consequentialHint: true },
    execute: async ({ flightId, passengers }) => {
      // TODO: perform the booking via your existing service; validate here.
      return `Booked ${passengers} passenger(s) on flight ${flightId}.`;
    },
  });

  return null;
}
