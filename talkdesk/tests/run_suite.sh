#!/bin/zsh
# Usage: run_suite.sh <run name> [draft|live]   (results in tests/runs/<run name>; default draft)
# Runs that reach sign-in send a real SMS to TD_TEST_PHONE.
cd "${0:A:h}"; OUT=runs/${1:?usage: run_suite.sh <name> [draft|live]}; S=${TD_SYSTEM_ID:-0f59d764-bbcd-4d4c-beec-61a0171f2882}; mkdir -p $OUT
DRAFT=true; [[ $2 == live ]] && DRAFT=false
run() { node td_sim.js .tok $S $DRAFT $OUT/$1.json "$2" > $OUT/$1.log 2>&1 }
for i in 1 2 3; do
  run probe_deduct_$i  "probe:What's my deductible?" &
  run probe_car_$i     "probe:I need to add a car to my policy." &
  run probe_driver_$i  "probe:I need to add my son as a driver." &
  run probe_claim_$i   "probe:I was in an accident yesterday and need to report it." &
  run probe_mail_$i    "probe:I need to change my mailing address." &
  wait
done
run person_1 person & run person_2 person & run billing_1 billing & run billing_2 billing &
run billing_q_1 billing_q & run quote_1 quote & wait
run lockout_1 lockout & run address_1 address & run claim_status_1 claim_status & wait
# Add then remove the same test driver / test vehicle, so the policy ends unchanged.
(run driver_add_1 driver_add && run driver_remove_1 driver_remove) &
(run vehicle_add_1 vehicle_add && run vehicle_remove_1 vehicle_remove) & wait
run address_2 address & run claim_status_2 claim_status & wait
python3 -I td_score.py $OUT/*.json | grep -E '^(PASS|FAIL)'
