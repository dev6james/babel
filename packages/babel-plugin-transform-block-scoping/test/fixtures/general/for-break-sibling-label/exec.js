loop: do {
  // This bit confuses `loopLabelVisitor`...
  () => { loop: {} };

  // ... causing `checkLoop` to fail to transform this `break`
  // to adapt to the wrapper function it inserts.
  if (false) break loop;

  // Then this bit is just to provoke `checkLoop` into doing
  // its work here in the first place.
  const x = 3;
  return [].map(_ => x)
} while (0);
