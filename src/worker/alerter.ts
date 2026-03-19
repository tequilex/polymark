export function canCreateAlert(
  lastAlertAtSec: number | null,
  nowSec: number,
  cooldownHours: number
): boolean {
  if (lastAlertAtSec === null) {
    return true;
  }

  const cooldownSec = cooldownHours * 3600;
  return nowSec - lastAlertAtSec >= cooldownSec;
}
