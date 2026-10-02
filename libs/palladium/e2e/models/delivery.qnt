module delivery {
  // This is an intentionally finite abstraction: change IDs 1..3 are slots
  // mapped bijectively by the replay harness to fresh UUIDv4 Changes and
  // UUIDv7 note rows. One writer owns each local DB; schema and ACL state are
  // fixed. Adapter transactions are atomic. A completed server append survives
  // process restart. Retry timing is abstracted; wire cursors stay opaque and
  // the integer checkpoint is only the normalized history-prefix length.
  // Power loss, filesystem corruption, LWW races, ACL transitions and concurrent
  // active-session edits are outside this model.
  var committed: Set[int]
  var outbox: List[int]
  var history: List[int]
  var applied: Set[int]
  var checkpoint: int
  var lastAction: str
  var lastId: int



  pure def listSet(xs: List[int]): Set[int] =
    xs.foldl(Set(), (acc, id) => acc.union(Set(id)))

  def pendingHistory: List[int] =
    if (checkpoint < 0) history else history.slice(checkpoint, history.length())
  action init = all {
    committed' = Set(),
    outbox' = List(),
    history' = List(),
    applied' = Set(),
    checkpoint' = -1,
    lastAction' = "init",
    lastId' = 0,
  }

  // A successful local row and its durable outbox entry are one transaction.
  action enqueue = {
    val id = committed.size() + 1
    all {
      committed.size() < 3,
      committed' = committed.union(Set(id)),
      outbox' = outbox.append(id),
      history' = history,
      applied' = applied,
      checkpoint' = checkpoint,
      lastAction' = "enqueue",
      lastId' = id,
    }
  }

  // Injected outbox insertion failure: the local transaction rolls back too.
  action rejectEnqueue = {
    val id = committed.size() + 1
    all {
      committed.size() < 3,
      committed' = committed,
      outbox' = outbox,
      history' = history,
      applied' = applied,
      checkpoint' = checkpoint,
      lastAction' = "rejectEnqueue",
      lastId' = id,
    }
  }

  // Each queued change receives a typed inserted/duplicate receipt. Only then
  // may the client atomically drain that durable outbox row.
  action upload = all {
    outbox.length() > 0,
    committed' = committed,
    outbox' = List(),
    history' = history.concat(outbox.select(id => not(id.in(listSet(history))))),
    applied' = applied,
    checkpoint' = checkpoint,
    lastAction' = "upload",
    lastId' = 0,
  }

  // The server commits (or recognizes a prior append), but the POST receipt is
  // lost. The original queue and ID/payload remain available for exact retry.
  action loseReceipt = all {
    outbox.length() > 0,
    committed' = committed,
    outbox' = outbox,
    history' = if (outbox.head().in(listSet(history))) history else history.append(outbox.head()),
    applied' = applied,
    checkpoint' = checkpoint,
    lastAction' = "loseReceipt",
    lastId' = 0,
  }

  // GET reaches the server, but a truncated body is rejected before durable
  // page application, leaving both rows and checkpoint untouched.
  action losePage = all {
    committed' = committed,
    outbox' = outbox,
    history' = history,
    applied' = applied,
    checkpoint' = checkpoint,
    lastAction' = "losePage",
    lastId' = 0,
  }

  // Every pending remote Change commits independently. Failure of the final
  // checkpoint transaction cannot roll back those already-applied Changes.
  action failCheckpoint = all {
    pendingHistory.length() > 0,
    committed' = committed,
    outbox' = outbox,
    history' = history,
    applied' = applied.union(listSet(pendingHistory)),
    checkpoint' = checkpoint,
    lastAction' = "failCheckpoint",
    lastId' = 0,
  }

  // Default block/quarantine policy: reject one unapplied remote Change, keep
  // other valid page Changes applied, and withhold the page checkpoint.
  action rejectChange = {
    nondet rejected = listSet(pendingHistory).exclude(applied).oneOf()
    all {
      committed' = committed,
      outbox' = outbox,
      history' = history,
      applied' = applied.union(listSet(pendingHistory).exclude(Set(rejected))),
      checkpoint' = checkpoint,
      lastAction' = "rejectChange",
      lastId' = rejected,
    }
  }
  // The complete page succeeds, including its final checkpoint callback.
  // checkpoint=-1 denotes no saved cursor; checkpoint=0 denotes empty prefix.
  action poll = all {
    committed' = committed,
    outbox' = outbox,
    history' = history,
    applied' = applied.union(listSet(pendingHistory)),
    checkpoint' = history.length(),
    lastAction' = "poll",
    lastId' = 0,
  }

  // These reopen/restart steps preserve durable state. They do not claim to
  // simulate power loss. Server restart follows a completed append boundary.
  action restartWriter = all {
    committed' = committed,
    outbox' = outbox,
    history' = history,
    applied' = applied,
    checkpoint' = checkpoint,
    lastAction' = "restartWriter",
    lastId' = 0,
  }

  action restartReader = all {
    committed' = committed,
    outbox' = outbox,
    history' = history,
    applied' = applied,
    checkpoint' = checkpoint,
    lastAction' = "restartReader",
    lastId' = 0,
  }

  action restartServer = all {
    committed' = committed,
    outbox' = outbox,
    history' = history,
    applied' = applied,
    checkpoint' = checkpoint,
    lastAction' = "restartServer",
    lastId' = 0,
  }

  // Normal bounded exploration: every transition is available when its guard
  // holds, so simulator seeds and the verifier explore varied delivery orders.
  action step = any {
    enqueue,
    rejectEnqueue,
    upload,
    loseReceipt,
    losePage,
    failCheckpoint,
    all {
      listSet(pendingHistory).exclude(applied).size() > 0,
      rejectChange,
    },
    poll,
    restartWriter,
    restartReader,
    restartServer,
  }

  // Fixed 13-transition recovery trace after init; dispatch uses existing
  // explicit action metadata, avoiding extra model state or padded repeats.
  action recoveryStep = any {
    all { lastAction == "init", rejectEnqueue },
    all { lastAction == "rejectEnqueue", enqueue },
    all { lastAction == "enqueue" and lastId == 1, loseReceipt },
    all { lastAction == "loseReceipt", upload },
    all { lastAction == "upload" and history.length() == 1, losePage },
    all { lastAction == "losePage", failCheckpoint },
    all { lastAction == "failCheckpoint", enqueue },
    all { lastAction == "enqueue" and lastId == 2, upload },
    all { lastAction == "upload" and history.length() == 2, rejectChange },
    all { lastAction == "rejectChange", poll },
    all { lastAction == "poll", restartWriter },
    all { lastAction == "restartWriter", restartReader },
    all { lastAction == "restartReader", restartServer },
  }

  def historyDistinct = history.length() == listSet(history).size()
  def outboxDistinct = outbox.length() == listSet(outbox).size()
  def historyCommitted = listSet(history).subseteq(committed)
  def outboxCommitted = listSet(outbox).subseteq(committed)
  def everyCommitRetained = committed.subseteq(listSet(outbox).union(listSet(history)))
  def appliedHistory = applied.subseteq(listSet(history))
  def checkpointRange = checkpoint >= -1 and checkpoint <= history.length()
  def checkpointApplied =
    if (checkpoint < 0) true else listSet(history.slice(0, checkpoint)).subseteq(applied)

  def safety = and {
    historyDistinct,
    outboxDistinct,
    historyCommitted,
    outboxCommitted,
    everyCommitRetained,
    appliedHistory,
    checkpointRange,
    checkpointApplied,
  }
}
