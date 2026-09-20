import { describe, expect, it } from 'vitest';
import { cents, formatEur, parseEur, MAX_CENTS, CentsError } from '@/lib/finance/money';
import { computePaid, computeRemaining, settlementStatus, settlePayment } from '@/lib/finance/settlements';
import { computeForecast, type ForecastInput } from '@/lib/finance/forecast';
const base = (): ForecastInput => ({balances:[{id:'a',amount:cents(100000)}],pendingIncome:[],ordinaryExpenses:[],reservedCommitments:[],internalTransfers:[],savingsTarget:cents(0)});
describe('Hermes independent contract regression',()=>{
  it('validates supplied target even when accounts are incomplete',()=>{
    expect(()=>computeForecast({...base(), balances:[], savingsTarget:cents(-1)})).toThrow(CentsError);
    expect(()=>computeForecast({...base(), balances:[{id:'unset',amount:null}], savingsTarget:NaN as ReturnType<typeof cents>})).toThrow(CentsError);
  });
  it('matches independent BigInt forecast oracle for 1000 deterministic scenarios',()=>{
    for(let n=0;n<1000;n++) {
      const b=BigInt(n*7919-3000000), income=BigInt(n*31), expense=BigInt(n*17), reserve=BigInt(n*7), target=BigInt(n*41);
      const result=computeForecast({...base(),balances:[{id:'a',amount:cents(Number(b))}],pendingIncome:[{id:'i',expected:cents(Number(income)),receivedCents:cents(0)}],ordinaryExpenses:[{id:'e',planned:cents(Number(expense)),paidCents:cents(0)}],reservedCommitments:[{id:'r',planned:cents(Number(reserve)),paidCents:cents(0)}],savingsTarget:cents(Number(target))});
      expect(result.projectedFreeToSpend).toBe(Number(b+income-expense-reserve-target));
      expect(result.cashBackedFreeToSpend).toBe(Number(b-expense-reserve-target));
    }
  });
  it('reversed flag excludes original payment instead of subtracting it again',()=>{
   expect(computePaid([{amount:cents(4000),reversed:true}])).toBe(0);
   expect(computeRemaining(cents(8000),[{amount:cents(4000),reversed:true}])).toBe(8000);
  });
  it('rejects invalid historical settlement amount',()=>{
   expect(()=>computePaid([{amount:cents(-1),reversed:false}])).toThrow(CentsError);
   expect(()=>computePaid([{amount:cents(0),reversed:false}])).toThrow(CentsError);
  });
  it('rejects overpaid history rather than returning negative remaining or paid status',()=>{
   const history=[{amount:cents(9000),reversed:false}];
   expect(()=>computeRemaining(cents(8000),history)).toThrow(CentsError);
   expect(()=>settlementStatus(cents(8000),history)).toThrow(CentsError);
  });
  it('rejects malformed planned cents as ok:false without throwing',()=>{
   const result=settlePayment({planned:NaN as ReturnType<typeof cents>,settlements:[],payment:cents(1)});
   expect(result.ok).toBe(false);
  });
  it('rejects negative target',()=>expect(()=>computeForecast({...base(),savingsTarget:cents(-1)})).toThrow(CentsError));
  it('rejects negative received income',()=>expect(()=>computeForecast({...base(),pendingIncome:[{id:'i',expected:cents(100),receivedCents:cents(-1)}]})).toThrow(CentsError));
  it('rejects negative paid expense',()=>expect(()=>computeForecast({...base(),ordinaryExpenses:[{id:'e',planned:cents(100),paidCents:cents(-1)}]})).toThrow(CentsError));
  it('same bank identity cannot silently inflate B (identical duplicates collapsed)',()=>{
   const input={...base(),balances:[{id:'a',amount:cents(100000)},{id:'a',amount:cents(100000)}]};
   expect(computeForecast(input).balancesTotal).toBe(100000);
  });
  it('conflicting same bank identity is rejected rather than choosing a number',()=>{
   const input={...base(),balances:[{id:'a',amount:cents(100000)},{id:'a',amount:cents(50000)}]};
   expect(()=>computeForecast(input)).toThrow(CentsError);
  });
  it('ordinary/reserved cross-category link counts once in R only',()=>{
   const input={...base(),ordinaryExpenses:[{id:'tax-view',planned:cents(10000),paidCents:cents(0),linkedReserveId:'tax'}],reservedCommitments:[{id:'tax',planned:cents(10000),paidCents:cents(0)}]};
   const result=computeForecast(input);
   expect(result.ordinaryUnpaid).toBe(0);
   expect(result.reservedOutstanding).toBe(10000);
   expect(result.ordinaryUnpaid+result.reservedOutstanding).toBe(10000);
  });
  it('ordinary/reserved same identity without link is rejected (no guessing)',()=>{
   const input={...base(),ordinaryExpenses:[{id:'tax',planned:cents(10000),paidCents:cents(0)}],reservedCommitments:[{id:'tax',planned:cents(10000),paidCents:cents(0)}]};
   expect(()=>computeForecast(input)).toThrow(CentsError);
  });
  it('round trips near safe-cent limits against bigint oracle',()=>{
   for(let offset=0;offset<512;offset++) {
    const n=MAX_CENTS-offset;
    const b=BigInt(n);const exact=`${b/100n}.${String(b%100n).padStart(2,'0')}`;
    expect(formatEur(cents(n))).toBe(exact);
    expect(parseEur(exact)).toBe(n);
   }
  });
});