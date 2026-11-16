const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,f(s));}
edit('src/onboarding-storage.ts',s=>{
s=s.replace("  const response = await supabase.rpc(atomicLoanSettings ?","  const response = await supabase.rpc(atomicLoanSettings ?");
// RPC adapters usually return network errors; a thrown transport failure is equally uncertain.
s=s.replace("    ...(desiredLoanSettings ? { p_expected_settings_revision: revisionOf(current), p_settings: desiredLoanSettings } : {}),\n  });","    ...(desiredLoanSettings ? { p_expected_settings_revision: revisionOf(current), p_settings: desiredLoanSettings } : {}),\n  }).catch(() => ({ data: null, error: { message: 'Connection interrupted while saving the account', code: undefined } }));");
s=s.replace("    if (incompatible) throw incompatible;\n    // A row-only match","    if (incompatible) throw incompatible;\n    if (response.error?.code === '40001' || response.error?.code === '23505' || response.error?.code === 'P0001' || response.error?.code === 'P0002') throw new DebtWriteConflictError();\n    if (response.error && (isConfirmedServerRejection(response.error.code) || response.error.code === '22023')) throw new DebtWriteFailedError('The server rejected the loan save: ' + response.error.message);\n    // A row-only match");
s=s.replace("    const provenRevision = Number(proof?.revision);","    if (!row || row.id !== debtId || !debtRowMatches(row, values, currency) || proof?.householdId !== current.householdId || proof.membershipVersion !== householdContext.membershipVersion) throw new DebtWriteUncertainError();\n    const provenRevision = Number(proof?.revision);");
return s;
});
edit('src/screens/HomeScreen.tsx',s=>{
s=s.replace("    if (savingRef.current) throw new Error('Another change is still saving. Try again in a moment.');\n    const currentData","    requireConfirmedSettings();\n    if (savingRef.current) throw new Error('Another change is still saving. Try again in a moment.');\n    const currentData");
const needle="      return true;\n    } finally {\n      savingRef.current = false;";
s=s.replace(needle,"      return true;\n    } catch (error) {\n      if (error instanceof Error && (error.name === 'FinancialSettingsUncertainError' || error.name === 'DebtWriteUncertainError' || error.name === 'DebtWriteConflictError')) markSettingsUncertain();\n      throw error;\n    } finally {\n      savingRef.current = false;");
s=s.replace("    if (!canEdit || pairingBusy || savingRef.current) return;\n    clearErrors();","    if (!canEdit || pairingBusy || savingRef.current) return;\n    if (settingsUncertainRef.current) { setLocalError('Check the unconfirmed settings save before resolving another loan.'); return; }\n    clearErrors();");
s=s.replace("    } catch (error) { setLocalError(error instanceof Error ? error.message : 'Unable to verify the loan conversion.'); }","    } catch (error) {\n      if (error instanceof Error && (error.name === 'FinancialSettingsUncertainError' || error.name === 'DebtWriteUncertainError' || error.name === 'DebtWriteConflictError')) markSettingsUncertain();\n      setLocalError(error instanceof Error ? error.message : 'Unable to verify the loan conversion.');\n    }");
return s;
});

