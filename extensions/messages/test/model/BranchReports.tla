---------------------------- MODULE BranchReports ----------------------------
(***************************************************************************)
(* How one branch's final answers reach its starter (@ultimate).           *)
(*                                                                         *)
(* The branch answers three inputs, one run at a time and in any arrival   *)
(* order: two from the user ("user1", "user2"), whose answers are work     *)
(* updates, and one reply-expected message from a sibling ("sibling"),     *)
(* whose answer goes back to the sibling. Each answer gets a board.route   *)
(* task (extensions/messages/route.ts), which the judge may hold back, and *)
(* the host may restart at any point.                                      *)
(*                                                                         *)
(* Each action is one commit, or one memo plus the call it guards:         *)
(*   RunYields         server.ts onYield calls observeRun to create        *)
(*                     board.route with after = started.lastRoute         *)
(*   RunEnds           the generation task settles; the inbox moves on     *)
(*   RouteAnswered     route.ts phase 'answered': picks note, judge,       *)
(*                     promotion of the last note, or 'landed' if no send  *)
(*   JudgeAsked        route.ts phase 'judge': memo 'asked', then the call *)
(*   JudgeAnswers      the call returns: memo 'judged'                     *)
(*   JudgeInterrupted  a rerun that finds 'asked' without 'judged':        *)
(*                     memo 'judged' = { error: 'interrupted' }            *)
(*   JudgeCommitted    the commit of Judgements and the 'forward'          *)
(*                     checkpoint, from memo 'judged'                      *)
(*   Send              send.ts: the append transaction, with its           *)
(*                     ConversationRequestReceipts check and, for a        *)
(*                     report, stillReports (the busy check)               *)
(*   Forwarded         route.ts phase 'forward': commits 'landed'          *)
(*   Complete          route.ts phase 'landed': the terminal commit        *)
(*   Restart           in-process judge calls are lost; commits stay       *)
(*                                                                         *)
(* UsePredecessor = FALSE removes `after`, as before f3c4c3da: TLC then    *)
(* finds the overtaking that review found three times (f05a2cbf,           *)
(* 0c993799): an older verdict waits, a newer report arrives, and the      *)
(* older answer reaches the starter last.                                  *)
(*                                                                         *)
(* CheckEveryReport = FALSE runs stillReports only for judged reports, as  *)
(* before this model found it: a promoted note then woke a busy starter.   *)
(*                                                                         *)
(* Left out: landing and conclusion, including delivery placement and     *)
(* workspace settlement inside 'landed'; extra routes from terminateRun;  *)
(* answers routed down from @ultimate; remote delivery; judge timeouts.   *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS UsePredecessor, CheckEveryReport, MaxRestarts

Inputs == {"user1", "user2", "sibling"}
Routes == 1..3
None == "none"
NoSend == [content |-> 0, report |-> FALSE, judged |-> None]

VARIABLES
    arrived,   \* inputs that reached the branch
    queue,     \* inputs queued behind the branch's run (InboxDoc)
    running,   \* the input the branch runs on now (LiveDoc.run), or None
    yielded,   \* the live run's route exists (started.yielded)
    nroutes,   \* routes created so far; route r carries answer r
    kind,      \* "work" or "sibling", by the input the answer settled
    after,     \* the route it waits for (started.lastRoute), 0 for none
    phase,     \* None, "observe", "judge", "forward", "landed" or "done"
    out,       \* what phase 'forward' sends to the starter
    asked,     \* memo 'asked'
    verdict,   \* memo 'judged': None, "report", "note" or "error"
    inflight,  \* the judge call is under way in this process
    sent,      \* the route's request receipt (route:<answer>)
    log,       \* the starter's messages from the branch, in append order
    restarts

vars == <<arrived, queue, running, yielded, nroutes, kind, after, phase, out, asked,
          verdict, inflight, sent, log, restarts>>

Busy == running # None \/ queue # <<>>

Last(s) == s[Len(s)]

Init ==
    /\ arrived = {}
    /\ queue = <<>>
    /\ running = None
    /\ yielded = FALSE
    /\ nroutes = 0
    /\ kind = [r \in Routes |-> None]
    /\ after = [r \in Routes |-> 0]
    /\ phase = [r \in Routes |-> None]
    /\ out = [r \in Routes |-> NoSend]
    /\ asked = [r \in Routes |-> FALSE]
    /\ verdict = [r \in Routes |-> None]
    /\ inflight = [r \in Routes |-> FALSE]
    /\ sent = [r \in Routes |-> FALSE]
    /\ log = <<>>
    /\ restarts = 0

InputArrives(i) ==
    /\ i \notin arrived
    /\ arrived' = arrived \cup {i}
    /\ queue' = Append(queue, i)
    /\ UNCHANGED <<running, yielded, nroutes, kind, after, phase, out, asked, verdict,
                   inflight, sent, log, restarts>>

RunStarts ==
    /\ running = None
    /\ queue # <<>>
    /\ running' = Head(queue)
    /\ queue' = Tail(queue)
    /\ UNCHANGED <<arrived, yielded, nroutes, kind, after, phase, out, asked, verdict,
                   inflight, sent, log, restarts>>

RunYields ==
    /\ running # None
    /\ ~yielded
    /\ yielded' = TRUE
    /\ LET r == nroutes + 1 IN
        /\ nroutes' = r
        /\ kind' = [kind EXCEPT ![r] = IF running = "sibling" THEN "sibling" ELSE "work"]
        /\ after' = [after EXCEPT ![r] = IF UsePredecessor THEN nroutes ELSE 0]
        /\ phase' = [phase EXCEPT ![r] = "observe"]
    /\ UNCHANGED <<arrived, queue, running, out, asked, verdict, inflight, sent, log,
                   restarts>>

RunEnds ==
    /\ yielded
    /\ running' = None
    /\ yielded' = FALSE
    /\ UNCHANGED <<arrived, queue, nroutes, kind, after, phase, out, asked, verdict,
                   inflight, sent, log, restarts>>

\* phase 'observe' waits on its generation and, with `after`, on the previous route.
GenerationSettled(r) == ~(yielded /\ r = nroutes)

Ready(r) ==
    /\ phase[r] = "observe"
    /\ GenerationSettled(r)
    /\ IF after[r] = 0 THEN TRUE ELSE phase[after[r]] = "done"

\* promoteLastNote: the last message is the branch's, neither a report nor a judged note.
Promotable(m) == ~m.report /\ m.judged # "note"

RouteAnswered(r) ==
    /\ Ready(r)
    /\ IF kind[r] = "work"
        THEN IF Busy
            THEN /\ phase' = [phase EXCEPT ![r] = "forward"]
                 /\ out' = [out EXCEPT ![r] = [content |-> r, report |-> FALSE, judged |-> None]]
            ELSE /\ phase' = [phase EXCEPT ![r] = "judge"]
                 /\ UNCHANGED out
        ELSE IF ~Busy /\ log # <<>> /\ Promotable(Last(log))
            THEN /\ phase' = [phase EXCEPT ![r] = "forward"]
                 /\ out' = [out EXCEPT ![r] = [content |-> Last(log).content, report |-> TRUE,
                                               judged |-> Last(log).judged]]
            ELSE /\ phase' = [phase EXCEPT ![r] = "landed"]
                 /\ UNCHANGED out
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, asked, verdict,
                   inflight, sent, log, restarts>>

JudgeAsked(r) ==
    /\ phase[r] = "judge"
    /\ ~asked[r]
    /\ asked' = [asked EXCEPT ![r] = TRUE]
    /\ inflight' = [inflight EXCEPT ![r] = TRUE]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, phase, out,
                   verdict, sent, log, restarts>>

JudgeAnswers(r, v) ==
    /\ inflight[r]
    /\ verdict' = [verdict EXCEPT ![r] = v]
    /\ inflight' = [inflight EXCEPT ![r] = FALSE]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, phase, out,
                   asked, sent, log, restarts>>

JudgeInterrupted(r) ==
    /\ phase[r] = "judge"
    /\ asked[r]
    /\ ~inflight[r]
    /\ verdict[r] = None
    /\ verdict' = [verdict EXCEPT ![r] = "error"]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, phase, out,
                   asked, inflight, sent, log, restarts>>

JudgeCommitted(r) ==
    /\ phase[r] = "judge"
    /\ verdict[r] # None
    /\ phase' = [phase EXCEPT ![r] = "forward"]
    /\ out' = [out EXCEPT ![r] = [content |-> r, report |-> verdict[r] # "note",
                                  judged |-> verdict[r]]]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, asked, verdict,
                   inflight, sent, log, restarts>>

Send(r) ==
    /\ phase[r] = "forward"
    /\ ~sent[r]
    /\ LET checked == CheckEveryReport \/ out[r].judged # None
           report == out[r].report /\ ~(checked /\ Busy) IN
        log' = Append(log, [route |-> r, content |-> out[r].content, report |-> report,
                            judged |-> out[r].judged, busy |-> Busy])
    /\ sent' = [sent EXCEPT ![r] = TRUE]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, phase, out, asked,
                   verdict, inflight, restarts>>

Forwarded(r) ==
    /\ phase[r] = "forward"
    /\ sent[r]
    /\ phase' = [phase EXCEPT ![r] = "landed"]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, out, asked,
                   verdict, inflight, sent, log, restarts>>

Complete(r) ==
    /\ phase[r] = "landed"
    /\ phase' = [phase EXCEPT ![r] = "done"]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, out, asked,
                   verdict, inflight, sent, log, restarts>>

Restart ==
    /\ restarts < MaxRestarts
    /\ restarts' = restarts + 1
    /\ inflight' = [r \in Routes |-> FALSE]
    /\ UNCHANGED <<arrived, queue, running, yielded, nroutes, kind, after, phase, out,
                   asked, verdict, sent, log>>

Quiescent ==
    /\ arrived = Inputs
    /\ ~Busy
    /\ \A r \in 1..nroutes : phase[r] = "done"

Done == Quiescent /\ UNCHANGED vars

Next ==
    \/ \E i \in Inputs : InputArrives(i)
    \/ RunStarts
    \/ RunYields
    \/ RunEnds
    \/ \E r \in Routes :
        \/ RouteAnswered(r)
        \/ JudgeAsked(r)
        \/ \E v \in {"report", "note"} : JudgeAnswers(r, v)
        \/ JudgeInterrupted(r)
        \/ JudgeCommitted(r)
        \/ Send(r)
        \/ Forwarded(r)
        \/ Complete(r)
    \/ Restart
    \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
\* The starter never reads an older answer after a newer one.
AnswersInOrder ==
    \A i, j \in 1..Len(log) : i < j => log[i].content <= log[j].content

\* A restart never lets the same route send twice.
SentOnce ==
    \A i, j \in 1..Len(log) : i # j => log[i].route # log[j].route

\* Once the branch has nothing under way, its last word to the starter woke it,
\* unless the judge called it back-and-forth with the user.
LastWordReported ==
    Quiescent /\ log # <<>> => Last(log).report \/ Last(log).judged = "note"

\* A report wakes the starter only while nothing of the branch is under way.
ReportsOnlyWhenIdle ==
    \A i \in 1..Len(log) : log[i].report => ~log[i].busy
=============================================================================
