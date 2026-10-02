import { Button, Modal, ModalDialog, Stack, Typography } from "@mui/joy";
import { useState } from "react";
import { FiAlertTriangle } from "react-icons/fi";
import useOverlayQueryParam from "@/navigation/useOverlayQueryParam";

/**
 * Bump the version suffix to show the notice again to visitors who already dismissed it.
 */
const STORAGE_KEY = "outdatedVersionNoticeDismissed:v1";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies): show the notice.
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Nothing to do, the notice will simply show up again on the next visit.
  }
}

/**
 * A modal shown to first-time visitors, warning them that this deployment is a legacy
 * version of the website which is no longer maintained.
 */
export default function OutdatedVersionNotice() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const hidden = useOverlayQueryParam();

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <Modal
      open={!dismissed && !hidden}
      onClose={dismiss}
      aria-labelledby="outdated-version-title"
      aria-describedby="outdated-version-description"
      sx={{ zIndex: 2100 }}
    >
      <ModalDialog
        variant="outlined"
        role="alertdialog"
        sx={{ maxWidth: "min(100% - 2rem, 32rem)", boxShadow: "xl" }}
      >
        <Stack gap={2}>
          <Stack direction="row" alignItems="center" gap={1}>
            <FiAlertTriangle size="1.4rem" aria-hidden />
            <Typography id="outdated-version-title" level="h5" fontWeight="700">
              You&apos;re viewing an outdated version
            </Typography>
          </Stack>
          <Typography id="outdated-version-description" level="body2" textColor="text.primary">
            This website is a legacy version and has not been updated in a while. Some of its
            content (projects, experience, contact details) may be out of date, and a
            completely rebuilt version is on its way.
          </Typography>
          <Stack direction="row" justifyContent="flex-end">
            <Button
              size="sm"
              color="neutral"
              onClick={dismiss}
              sx={(theme) => ({
                backgroundColor: theme.palette.text.primary,
                color: theme.palette.background.body,
                "&:hover": { backgroundColor: theme.palette.text.secondary },
                "&:active": { backgroundColor: theme.palette.text.tertiary },
              })}
            >
              Got it, continue
            </Button>
          </Stack>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
