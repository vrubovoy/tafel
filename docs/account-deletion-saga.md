# Account deletion consumer

`POST /internal/v1/account-deletions` accepts only a short-lived Schlussel
RS256 token with exact `hof-deletion:tafel` audience, deletion token use and
scope, and subject/job claims matching the strict request body.

One transaction records the job and permanent tombstone, removes the user's
projects, statuses, tasks, due-occurrence identities, and notification outbox,
then removes the local user. Exact replay succeeds, identity mismatch
conflicts, and tombstoned users cannot be materialized by old access tokens.
