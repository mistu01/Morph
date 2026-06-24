# {{MODULE_NAME}}

Install this ZIP with Magisk, KernelSU, KernelSU Next, or APatch, then reboot.

During installation, the module registers the original package using the stock APK files, then bind-mounts the patched APK over the package base APK.
The module re-applies the bind mount and Play Store detach commands at boot.
This keeps the launcher entry tied to the original package while running the patched APK.

Additionally, this module contains MeowDump's Unlimited Photos Storage Zygisk component to spoof the device as a Google Pixel (2016) for Google Photos, enabling unlimited original-quality storage.

Included apps:
- Google Photos: com.google.android.apps.photos
