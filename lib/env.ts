// Loads .env into process.env if it exists. Imported first by genie.ts and the spikes.
try {
  process.loadEnvFile('.env')
} catch {
  /* no .env: fakes run */
}
