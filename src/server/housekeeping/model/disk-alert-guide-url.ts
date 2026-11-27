/**
 * The operator guide section the disk warning and critical emails link to.
 *
 * One value on every instance: the guide lives on the project's docs site, not
 * on the instance. bin/deploy.sh declares the same URL for its own disk-full
 * message; disk-alert-copy.test.ts holds the two equal.
 */
export const DISK_ALERT_GUIDE_URL = 'https://docs.pavillion.social/guides/instance-administrators/monitoring-and-logs#when-the-disk-alert-arrives';
