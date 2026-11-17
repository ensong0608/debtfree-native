const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n'); fs.writeFileSync(p,f(s));}
function removeElement(s,target,open,close){const at=s.indexOf(target);if(at<0)throw Error('missing '+target);const a=s.lastIndexOf(open,at),b=s.indexOf(close,at);if(a<0||b<0)throw Error('element');return s.slice(0,a)+s.slice(b+close.length)}
edit('src/screens/HomeScreen.tsx',s=>{
s=removeElement(s,"onPress={() => void handleResolveDivergentLink(link, 'unlink')}","<Pressable","</Pressable>");
s=removeElement(s,"onPress={() => void handleReviewLoanPairing(item.debtId, null)}","<Pressable","</Pressable>");
const a=s.indexOf('  const handleReviewLoanPairing ='),b=s.indexOf('  const handleResolveDivergentLink',a);
if(a>=0)s=s.slice(0,a)+s.slice(b);
s=s.replace("  const handleSaveLoanBillPairings = async (loanBillPairingByDebtId: NonNullable<UserOnboardingData['loanBillPairingByDebtId']>) => {","  const handleSaveLoanBillPairings = async (loanBillPairingByDebtId: NonNullable<UserOnboardingData['loanBillPairingByDebtId']>) => {\n    for (const [id, relation] of Object.entries(latestOnboardingRef.current.loanBillPairingByDebtId ?? {})) {\n      if (relation?.status === 'linked' && (loanBillPairingByDebtId[id]?.status !== 'linked' || loanBillPairingByDebtId[id]?.billId !== relation.billId)) throw new Error('Historical loan identity cannot be detached. Use the shared loan editor.');\n    }");
const del="      const localBillId = validatedLoanBillLinks(currentData.loanBillPairingByDebtId, recurringBills, currentData.debts)[debtId] ?? null;";
s=s.replace(del,del+"\n      const relation = currentData.loanBillPairingByDebtId?.[debtId];\n      if (relation?.status === 'linked' && relation.billId !== localBillId) throw new Error('This loan has historical bill references that cannot be safely validated for deletion. No records were removed.');");
const target="            <SnapshotCard debts=";
s=s.replace(target,"            {incompleteLoanSchedules.length > 0 ? <Card><Text style={ui.heading}>Loan due dates needed</Text><Text style={ui.small}>These accounts are included in Budget but cannot appear in payment reminders until a due day is set.</Text>{incompleteLoanSchedules.map(debt => <Pressable key={debt.id} accessibilityRole=\"button\" disabled={!canEdit} onPress={() => openEditDebtEditor(debt)} style={ui.button}><Text style={ui.buttonText}>{debt.name} — Set due day</Text></Pressable>)}</Card> : null}\n"+target);
return s;
});
edit('src/screens/DebtScreen.tsx',s=>{
s=s.replace("import { validatedLoanBillLinks }","import { uniqueHistoricalBillIdByDebtId }");
s=s.replace("validatedLoanBillLinks(loanBillPairings, recurringBills, debts)","uniqueHistoricalBillIdByDebtId(loanBillPairings)");
if(s.includes("onPress={() => setConfirmPairingAction('unlink')}"))s=removeElement(s,"onPress={() => setConfirmPairingAction('unlink')}","<Pressable","</Pressable>");
if(s.includes("onPress={() => setConfirmPairingAction('remove')}"))s=removeElement(s,"onPress={() => setConfirmPairingAction('remove')}","<Pressable","</Pressable>");
return s;
});
edit('src/screens/BudgetScreen.tsx',s=>{
s=s.replace("  selectUnifiedBudgetLoans,","  selectUnifiedBudgetLoans,\n  hasUnresolvedLegacyLoanLinks,\n  uniqueHistoricalBillIdByDebtId,");
s=s.replace("  const divergentDebtIds = pairingAudit.divergentLinks.map(link => link.debt.id);","  const budgetUnresolved = hasUnresolvedLegacyLoanLinks(pairingAudit);\n  const divergentDebtIds = [...pairingAudit.divergentLinks.map(link => link.debt.id), ...pairingAudit.invalidLinks.map(item => item.debtId)];");
s=s.replace("  const openBillEditor = (bill: RecurringBill) => {","  const openBillEditor = (bill: RecurringBill) => {\n    const loanId = Object.entries(uniqueHistoricalBillIdByDebtId(data.loanBillPairingByDebtId)).find(([, id]) => id === bill.id)?.[0];\n    if (loanId) {\n      const loan = data.debts.find(item => item.id === loanId);\n      if (loan && onEditLoan) onEditLoan(loan);\n      else Alert.alert('Loan history preserved', 'Edit this obligation from Accounts.');\n      return;\n    }");
if(s.includes('>Unlink loan payment</Text>'))s=removeElement(s,'>Unlink loan payment</Text>','<Pressable','</Pressable>');
s=s.replace("                const freePercent = income > 0 ?","                if (budgetUnresolved) return <View accessibilityRole=\"alert\" style={{ gap: 6 }}><Text style={ui.heading}>Budget and available amount unavailable</Text><Text style={ui.small}>Resolve the saved loan identities on Home to calculate these totals without counting the same obligation twice.</Text></View>;\n                const freePercent = income > 0 ?");
s=s.replace("{item.percentOfIncome}%</Text>","{budgetUnresolved ? '—' : item.percentOfIncome + '%'}</Text>");
s=s.replace("value={formatCurrency(item.amount, currencySymbol)}","value={budgetUnresolved ? 'Review needed' : formatCurrency(item.amount, currencySymbol)}");
s=s.replace("width: \u0060${Math.max(0, Math.min(100, item.percentOfIncome))}%\u0060","width: budgetUnresolved ? '0%' : \u0060${Math.max(0, Math.min(100, item.percentOfIncome))}%\u0060");
return s;
});

