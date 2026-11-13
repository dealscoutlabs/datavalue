<!-- Agent script for roofing callbacks. Variables come from callcenter/script.py and are neutral only:
     never say or imply that we saw, inspected or detected damage. -->
## Opening (always read)
"Hi, may I speak with {first_name}? This is {agent_name} calling on behalf of RoofSignal. You asked us to call you
back about a free roof estimate{request_context}. This call may be recorded for quality. Is now still a good time?"

If they ask to stop being called: say "I'll make sure you're not called again," then use disposition DNC_REQUESTED.

## Why we're calling (pick what applies; never more)
{talking_points}

## About us (if asked)
"RoofSignal is a referral service. We don't do roofing work ourselves. We match you with one licensed, insured
local contractor, who contacts you to set up an inspection and estimate."

## Qualify
1. "Just to confirm, are you the owner of the home at {property_address}?"
2. "Is there anything about the roof that's concerning you right now?"
3. "If you decided to move ahead, what timeline are you thinking?"
4. "Are you planning to involve your homeowner's insurance?" (Record the answer only. Do not give insurance advice.)
5. "What's the best day and time for the contractor to come out?"

## Close
"Thank you. A licensed contractor from our network will contact you about your appointment. Before I go, would you
like us to add your number to our do-not-call list after this?"
