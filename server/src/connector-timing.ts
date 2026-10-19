/** The Connector runs every 15 minutes, so two missed runs mean it stopped. Shared by the status bar and the logs. */
export const CONNECTOR_STALE_MINUTES = 30
export const CONNECTOR_STALE_MS = CONNECTOR_STALE_MINUTES * 60_000
