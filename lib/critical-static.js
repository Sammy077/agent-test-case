'use strict';
// Static reference dataset for the /tv/critical screen.
//
// The screen renders from this fixed dataset instead of from an uploaded workbook.
// The numbers mirror the approved design reference:
//   114 Critical cases; Channel split All 114 / POS 38 / eKYC 46 / Others 30;
//   Not Executed 74; Missing TID 47; TID Completion 58.8% (67 / 114);
//   Finance Correct 0 / Incorrect 0 / Not Verify Yet 47 / Pending 47 / N/A 20;
//   Test Execution Status: Passed 0 / Failed 0 / Not Executed 74 / Missing TID 47 / No Perform TXN 30.
//
// The reference's tester table was cut off at row 10, so testers 11-13 are sample rows
// added to make the list complete. This module matches the shape returned by
// lib/critical-dashboard.js summary().

const metrics={
  total:114,pos:38,ekyc:46,other_channel:30,
  not_executed:74,passed:0,failed:0,blocked:0,retest_required:0,
  missing_tid:47,tid_required:47,tid_completed:0,tid_completion_pct:58.8,
  finance_correct:0,finance_error:0,finance_pending:47,finance_no_txn:30,finance_verified:30,finance_completion_pct:26.3,
  finance_not_verify_yet:47,finance_pending_raw:47,finance_na:20,
};

const channels=[
  {name:'POS',value:38},
  {name:'eKYC',value:46},
  {name:'Others',value:30},
];

const finance=[
  {name:'Correct',value:0},
  {name:'Incorrect',value:0},
  {name:'Not Verify Yet',value:47},
  {name:'Pending',value:47},
  {name:'N/A',value:20},
];

const rows=[
  ['Koemly Hort',23,15,8],
  ['Setharoth Sorm',22,14,8],
  ['Sam At Ek',12,8,6],
  ['Det Dam',10,7,4],
  ['Sakhorn Pok',10,7,4],
  ['Phally Dim',10,7,4],
  ['Sreypech Yan',9,6,3],
  ['Monyrath Meach',9,6,3],
  ['Chhaya Khay',6,4,2],
  ['Mengchou Mann',6,4,2],
  ['Sophanny Chhuon',5,3,2],
  ['Visal Phok',4,3,1],
  ['Unassigned',3,2,1],
];

const testers=rows.map(([name,total,not_executed,missing_tid])=>({
  name,total,passed:0,failed:0,not_executed,blocked:0,retest_required:0,missing_tid,
  finance_correct:0,finance_error:0,finance_pending:missing_tid,finance_no_txn:0,
  executed:0,pending:not_executed,
  completion_pct:total?Math.round((total-not_executed)/total*1000)/10:0,
}));

function summary(){
  return {
    source:{file_name:'MASTER - All Test Cases',sheet_name:'MASTER - All Test Cases',priority_filter:'Critical',imported_at:null,imported_by:''},
    metrics,
    channels,
    finance,
    testers,
    allTidCompletedAt:null,
  };
}

module.exports={summary};
