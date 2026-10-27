// Links into the game from before it moved to /the-mmo/ arrive here: invites
// (?with=) and a save handed over from the old address (#carry=). Send them
// on, address and all, before the hub even draws.
if (/[?&]with=/.test(location.search) || /(^#|&)carry=/.test(location.hash)) {
  location.replace(`the-mmo/${location.search}${location.hash}`);
}
