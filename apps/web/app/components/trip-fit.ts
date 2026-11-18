import { createContext } from "react";

/**
 * The width (px) a trip poster fits its giant word in when it is in a carousel row: the width of the card next to the one in front (the medium one), which is as much of a card as is seen
 * when it is not the one in front, and all of the last one's, where the row stops (components/trip-rail.tsx). A word wider than that is condensed, then made smaller, so that it is never cut off
 * by the edge of its card at rest. null: no row (one trip alone): the poster's own width.
 */
export const TripFit = createContext<number | null>(null);
