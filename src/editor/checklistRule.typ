// Checklists: "- [ ] task" is a task to do, "- [x] task" one that's done.
#show list: it => {
  let text-of(part) = part.at("text", default: none)
  let task(item) = {
    let parts = if item.body.has("children") { item.body.children } else { () }
    if parts.len() < 3 or text-of(parts.at(0)) != "[" or text-of(parts.at(2)) != "]" { return none }
    let done = text-of(parts.at(1)) == "x"
    if not done and parts.at(1).func() != [ ].func() { return none }
    let rest = parts.slice(3)
    if rest.len() > 0 and rest.first().func() == [ ].func() { rest = rest.slice(1) }
    // Its own text, and the list nested under it (which isn't dimmed with it).
    let nested = rest.filter(part => part.func() == list.item)
    (done: done, own: rest.filter(part => part.func() != list.item).join(), nested: nested.join())
  }
  let tasks = it.children.map(task)
  if tasks.all(t => t == none) { return it }
  let checkbox(done) = box(
    width: 0.8em, height: 0.8em, baseline: 0.1em, radius: 2pt, stroke: 0.6pt + luma(120),
    if done { align(center + horizon, text(0.75em, sym.checkmark)) },
  )
  let rows = it.children.zip(tasks).map(((item, t)) => if t == none {
    ([•], item.body)
  } else {
    (checkbox(t.done), [#if t.done { text(fill: luma(130), t.own) } else { t.own }#t.nested])
  })
  block(grid(columns: (auto, 1fr), column-gutter: 0.5em, row-gutter: 0.65em, ..rows.flatten()))
}
