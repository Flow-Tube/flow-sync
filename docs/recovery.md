# Recovery

How to get your synced data back when devices or the recovery key go missing. Linked devices is under Settings > Sync devices in Flow for Android, and under Sync in Flow Desktop.

## The recovery key

Creating a group shows a recovery key once: 24 words and a QR code. Flow asks for two of the words back before it counts the key as saved, and Linked devices warns until you do. Keep the words offline. Anyone who has them can restore the group once, and nobody, including whoever runs the server, can recover the data without either a linked device or the words.

## You lost one device

On another device, open Linked devices, pick the lost one and choose Remove. The remaining devices switch to a new group key and the server shuts the lost device out at once. Whatever it had already synced stays on it. If it turns up again, it shows that it was removed and stops syncing (on Android, forget the group there first); then you can link it again.

## You lost every device, but have the words

1. Install Flow on a new device and open Linked devices.
2. Choose Restore with recovery words (Android) or Restore with recovery key (Desktop).
3. Say where the group is: the Flow server's address, or the WebDAV folder's address, user name and password. Then enter the 24 words.
4. The device joins, starts a new group key, reads your synced data, and shows new recovery words. Write them down: the old words stop working.

A group that lives only on its devices (LAN only) keeps nothing on a store, so there is nothing to restore from.

## You lost the words, but have a device

Your data is safe while any device is linked. On a linked device, open Linked devices and choose Replace recovery words. Flow makes new words and moves your devices to a new encryption key; the old words stop working. Write the new words down.

## Someone else may have your words

Replace the words from a linked device (above) before they use them: the old words then can't restore the group or read anything synced afterwards. Data synced before the replacement stays readable to anyone with the old words who can still read the store's files, for example with a WebDAV folder's password.

If they restored first, your devices list a device you don't know. Remove it, then replace the recovery words, because their restore gave them a recovery key of their own.

## You lost every device and the words

The synced data can't be recovered by anyone. Start a new group: on a Flow server, a device can reset the server and start a new group with the admin token; on WebDAV, use a new, empty folder.

## The server or folder is gone

Each linked device still has its own copy of your data. Set up a new server or folder, create a new group on one device, and link the others to it; their data merges into the new group.
