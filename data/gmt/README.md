# GMT Publishing magazines (client data)

Place the 10 GMT magazine issues here — the French source and the published
English / German translations of each issue:

```
data/gmt/pdf/<issue>/fr.pdf
data/gmt/pdf/<issue>/en.pdf
data/gmt/pdf/<issue>/de.pdf
```

These files are confidential client material: they are **not** part of the public
crawl and must never be pushed to a public dataset. Text extraction and
segment alignment (step 2) will produce `data/interim/gmt/` with the same
`ParallelSegment` schema as the other sources.
