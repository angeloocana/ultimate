----------------------------- MODULE LanderChecks -----------------------------
(***************************************************************************)
(* How the lander records one check of one landing attempt                 *)
(* (extensions/workspaces/lander.ts, runCheckWithOneDurableRerun): a first *)
(* run, one rerun after a failed first run, and a host restart at any of   *)
(* the places the lander saves its progress.                               *)
(*                                                                         *)
(* Each action is one commit, or the command run it follows:               *)
(*   Resume       runCheckWithOneDurableRerun starts (again) and reads     *)
(*                QueueEntry.checks (Mode "atomic") or the check memos     *)
(*                (the older modes)                                        *)
(*   Run(n)       the check command runs in this process: run 1 is the     *)
(*                first run, run 2 the rerun; it passes or fails           *)
(*   Record(n)    Mode "atomic": the commit that logs the result, emits   *)
(*                CheckRan and saves the outcome in QueueEntry.checks      *)
(*   Log(n)       the older modes: the step commit with the log and        *)
(*                CheckRan, and nothing else                               *)
(*   Cause        the older modes: memo '<check>:cause'                    *)
(*   Memo(n)      the older modes: memo '<check>' (run 1) or               *)
(*                '<check>:rerun' (run 2)                                  *)
(*   Restart      the host closes: what ran in memory is lost, commits     *)
(*                and memos stay                                           *)
(*                                                                         *)
(* Mode "causeFirst" is 8985e550: cause memo, log, first-run memo, and a   *)
(* resume reads the first-run memo only. Review found that a restart after *)
(* the cause memo reran the first run and could lose the flaky note        *)
(* (c1685d08). Mode "split" is c1685d08 until this model: log, cause memo, *)
(* first-run memo, and a resume counts a saved cause as a failed first     *)
(* run; a restart after the log reruns a logged run, and when that rerun   *)
(* passes the flaky note is lost. Mode "atomic" saves each run's outcome   *)
(* in the commit that logs it.                                             *)
(*                                                                         *)
(* Left out: groups (members run side by side but record apart), the      *)
(* second landing attempt after the target moved (its checks start over    *)
(* under a new attempt number), the watchdog (a stopped check is a failed  *)
(* run) and what the check prints.                                         *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS Mode, MaxRestarts

None == "none"
Results == {"passed", "failed"}

VARIABLES
    pc,        \* "resume", "run1", "ran1", "run2", "ran2" or the next older-mode write
    ran,       \* the result of the run in memory, or None
    log,       \* runs whose "checked" step committed (the lander log and CheckRan)
    first,     \* saved first-run outcome: None, "passed" or "failed"
    cause,     \* a saved first-run cause
    rerun,     \* saved rerun outcome: None, "passed" or "failed"
    verdict,   \* None, "passed", "flaky", "flakyWithoutCause" or "failed"
    restarts

vars == <<pc, ran, log, first, cause, rerun, verdict, restarts>>

Init ==
    /\ pc = "resume"
    /\ ran = None
    /\ log = <<>>
    /\ first = None
    /\ cause = FALSE
    /\ rerun = None
    /\ verdict = None
    /\ restarts = 0

SavedFirst ==
    IF first # None THEN first
    ELSE IF Mode = "split" /\ cause THEN "failed"
    ELSE None

Resume ==
    /\ pc = "resume"
    /\ verdict = None
    /\ IF SavedFirst = None THEN pc' = "run1" /\ UNCHANGED verdict
       ELSE IF SavedFirst = "passed" THEN pc' = "done" /\ verdict' = "passed"
       ELSE IF rerun = None THEN pc' = "run2" /\ UNCHANGED verdict
       ELSE IF rerun = "failed" THEN pc' = "done" /\ verdict' = "failed"
       ELSE pc' = "done" /\ verdict' = IF cause THEN "flaky" ELSE "flakyWithoutCause"
    /\ UNCHANGED <<ran, log, first, cause, rerun, restarts>>

Run(n) ==
    /\ pc = IF n = 1 THEN "run1" ELSE "run2"
    /\ \E r \in Results : ran' = r
    /\ pc' = IF n = 1 THEN "ran1" ELSE "ran2"
    /\ UNCHANGED <<log, first, cause, rerun, verdict, restarts>>

Logged(n) == Append(log, [run |-> n, result |-> ran])

Record(n) ==
    /\ Mode = "atomic"
    /\ pc = IF n = 1 THEN "ran1" ELSE "ran2"
    /\ log' = Logged(n)
    /\ IF n = 1
        THEN /\ first' = ran
             /\ cause' = (ran = "failed")
             /\ UNCHANGED rerun
        ELSE /\ rerun' = ran
             /\ UNCHANGED <<first, cause>>
    /\ pc' = "resume"
    /\ ran' = None
    /\ UNCHANGED <<verdict, restarts>>

\* The older modes: the next write after run n, in their order.
After(n, write) ==
    CASE n = 2 /\ write = "log" -> "memo2"
      [] n = 2 /\ write = "memo" -> "resume"
      [] Mode = "split" /\ write = "log" -> IF ran = "failed" THEN "cause" ELSE "memo1"
      [] Mode = "split" /\ write = "cause" -> "memo1"
      [] Mode = "causeFirst" /\ write = "cause" -> "log1"
      [] Mode = "causeFirst" /\ write = "log" -> "memo1"
      [] write = "memo" -> "resume"

FirstWrite(n) ==
    IF n = 2 THEN "log2"
    ELSE IF Mode = "causeFirst" /\ ran = "failed" THEN "cause" ELSE "log1"

Begin(n) ==
    /\ Mode # "atomic"
    /\ pc = IF n = 1 THEN "ran1" ELSE "ran2"
    /\ pc' = FirstWrite(n)
    /\ UNCHANGED <<ran, log, first, cause, rerun, verdict, restarts>>

Log(n) ==
    /\ pc = IF n = 1 THEN "log1" ELSE "log2"
    /\ log' = Logged(n)
    /\ pc' = After(n, "log")
    /\ UNCHANGED <<ran, first, cause, rerun, verdict, restarts>>

Cause ==
    /\ pc = "cause"
    /\ cause' = TRUE
    /\ pc' = After(1, "cause")
    /\ UNCHANGED <<ran, log, first, rerun, verdict, restarts>>

Memo(n) ==
    /\ pc = IF n = 1 THEN "memo1" ELSE "memo2"
    /\ IF n = 1
        THEN /\ first' = IF first = None THEN ran ELSE first
             /\ UNCHANGED rerun
        ELSE /\ rerun' = IF rerun = None THEN ran ELSE rerun
             /\ UNCHANGED first
    /\ pc' = After(n, "memo")
    /\ ran' = None
    /\ UNCHANGED <<log, cause, verdict, restarts>>

Restart ==
    /\ restarts < MaxRestarts
    /\ verdict = None
    /\ restarts' = restarts + 1
    /\ pc' = "resume"
    /\ ran' = None
    /\ UNCHANGED <<log, first, cause, rerun, verdict>>

Done == verdict # None /\ UNCHANGED vars

Next ==
    \/ Resume
    \/ \E n \in {1, 2} : Run(n) \/ Record(n) \/ Begin(n) \/ Log(n) \/ Memo(n)
    \/ Cause
    \/ Restart
    \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
Runs(n) == {i \in 1..Len(log) : log[i].run = n}

\* A run whose "checked" step committed never runs again: the first run once, the rerun once.
RecordedRunNotRepeated ==
    \A n \in {1, 2} : \A i, j \in Runs(n) : i = j

\* A rerun happens only after a failed first run was recorded.
RerunOnlyAfterRecordedFailure ==
    \A i \in Runs(2) : \E j \in Runs(1) : j < i /\ log[j].result = "failed"

\* Once a first-run failure is recorded, the landing never counts the check as passed, and a flaky
\* note carries the first run's cause.
DiagnosisKept ==
    /\ (\E i \in Runs(1) : log[i].result = "failed") \/ cause => verdict \notin {"passed", "flakyWithoutCause"}
    /\ verdict = "flaky" => \E i \in Runs(1) : log[i].result = "failed"
=============================================================================
