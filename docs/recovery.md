# Recovery

How to get your synced data back when devices or the recovery key go missing. Linked devices is under Settings > Sync devices in Flow for Android, and under Sync in Flow Desktop.

## The recovery key

Creating a group shows a recovery key once: 24 words and a QR code. Flow asks for two of the words back before it counts the key as saved, and Linked devices warns until you do. Keep the words offline. Anyone who has them can restore the group once and sign out its other devices, and nobody, including whoever runs the server, can recover the data without either a linked device or the words.

## You lost one device

On another device, open Linked devices, pick the lost one and choose Remove. The remaining devices switch to a new group key and the server shuts the lost device out at once. Whatever it had already synced stays on it. If it turns up again, it shows that it was removed and stops syncing (on Android, forget the group there first); then you can link it again.

If that device set the current recovery words, Flow replaces them in the same step and shows you new ones, so write them down. Flow also lists the devices the lost one added: remove any you don't recognise. Changes the lost device made that your other devices hadn't read yet may not arrive.

Replacing the recovery words afterwards is worth doing if the device was lost or stolen. New words can only restore a group that already has the removal in it.

If a device replaces the recovery words and you didn't ask it to, your other devices tell you. Remove that device. If it also left the group, your devices stop syncing changes until you make new words on one of them.

## You lost every device, but have the words

If you still have a working device, link the new one from it instead. A restore signs out your other devices.

1. Install Flow on a new device and open Linked devices.
2. Choose Restore with recovery words (Android) or Restore with recovery key (Desktop).
3. Say where the group is: the Flow server's address, or the WebDAV folder's address, user name and password. Then enter the 24 words.
4. Flow lists the group's devices. Tick only the ones you have with you. Every other device is signed out, so a lost or stolen one reads nothing you sync from now on. Don't tick a device just because its name looks right.
5. The device joins, starts a new group key, reads your synced data, and shows new recovery words. Write them down: the old words stop working.

A device you didn't tick shows that it was removed, and you can link it again. Its own data merges back when you do.

Check that the data looks current. Flow can't prove that what a store shows it during a restore is the newest version.

A group that lives only on its devices (LAN only) keeps nothing on a store, so there is nothing to restore from.

## You lost the words, but have a device

Your data is safe while any device is linked. On a linked device, open Linked devices and choose Replace recovery words. Flow makes new words and moves your devices to a new encryption key; the old words stop working. Write the new words down.

## Someone else may have your words

Replace the words from a linked device (above) before they use them: the old words then can't restore the group or read anything your devices sync once they have the new key. Data synced before that stays readable to anyone with the old words who can still read the store's files, for example with a WebDAV folder's password. This includes changes a device made before it picked up the new key, for example while offline.

If they restored first, they may have signed out your devices. A device that is still in the group tells you, and lists a device you don't know: remove it, and Flow replaces their recovery key in the same step and shows you new words. A device that was signed out says so. Then start a new group, on a server you've reset or in a new WebDAV folder with a new password, and link your devices to it. Each device still has its own copy of your data, and the copies merge.

## You lost every device and the words

The synced data can't be recovered by anyone. Start a new group: on a Flow server, a device can reset the server and start a new group with the admin token; on WebDAV, use a new, empty folder.

## The server or folder is gone

Each linked device still has its own copy of your data. Set up a new server or folder, create a new group on one device, and link the others to it; their data merges into the new group.
