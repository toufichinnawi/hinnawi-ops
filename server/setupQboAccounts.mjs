/**
 * Setup QBO accounts for Revenue JE generation
 * 1. Get existing QBO accounts
 * 2. Create missing accounts (bank accounts, Sales Revenue, GST/QST Payable, Tips Payable)
 * 3. Update local bank accounts with correct qboAccountId
 */
import 'dotenv/config';

async function main() {
  const qbo = await import('./qbo.ts');
  const db = await import('./db.ts');

  console.log('=== QBO Account Setup ===\n');

  // Step 1: Get all existing QBO accounts
  console.log('Fetching QBO accounts...');
  const accountsResp = await qbo.getAccounts();
  const accounts = accountsResp?.QueryResponse?.Account || [];
  console.log(`Found ${accounts.length} accounts in QBO\n`);

  // Print all accounts grouped by type
  const byType = {};
  for (const a of accounts) {
    const type = a.AccountType || 'Unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push({ id: a.Id, name: a.Name, subType: a.AccountSubType, balance: a.CurrentBalance });
  }

  for (const [type, accts] of Object.entries(byType)) {
    console.log(`\n--- ${type} ---`);
    for (const a of accts) {
      console.log(`  ID: ${a.id} | ${a.name} (${a.subType}) | Balance: $${a.balance || 0}`);
    }
  }

  // Step 2: Find or create required accounts
  console.log('\n\n=== Required Account Mapping ===');
  
  const findAccount = (name, type) => {
    return accounts.find(a => 
      a.Name.toLowerCase().includes(name.toLowerCase()) && 
      (!type || a.AccountType === type)
    );
  };

  // Sales Revenue
  let salesRevenue = findAccount('Sales', 'Income') || findAccount('Revenue', 'Income');
  console.log(`Sales Revenue: ${salesRevenue ? `ID ${salesRevenue.Id} - ${salesRevenue.Name}` : 'NOT FOUND - will create'}`);

  // GST Payable
  let gstPayable = findAccount('GST', 'Other Current Liability') || findAccount('GST Payable');
  console.log(`GST Payable: ${gstPayable ? `ID ${gstPayable.Id} - ${gstPayable.Name}` : 'NOT FOUND - will create'}`);

  // QST Payable
  let qstPayable = findAccount('QST', 'Other Current Liability') || findAccount('QST Payable');
  console.log(`QST Payable: ${qstPayable ? `ID ${qstPayable.Id} - ${qstPayable.Name}` : 'NOT FOUND - will create'}`);

  // Tips Payable
  let tipsPayable = findAccount('Tips', 'Other Current Liability') || findAccount('Tips Payable');
  console.log(`Tips Payable: ${tipsPayable ? `ID ${tipsPayable.Id} - ${tipsPayable.Name}` : 'NOT FOUND - will create'}`);

  // Merchant Fees
  let merchantFees = findAccount('Merchant', 'Expense') || findAccount('Credit Card Fees', 'Expense') || findAccount('Bank Charges', 'Expense');
  console.log(`Merchant Fees: ${merchantFees ? `ID ${merchantFees.Id} - ${merchantFees.Name}` : 'NOT FOUND - will create'}`);

  // Bank accounts per location
  // getAllBankAccounts doesn't exist, use direct query
  const { getDb } = await import('./db.ts');
  const { bankAccounts: bankAccountsTable } = await import('../drizzle/schema.ts');
  const { asc } = await import('drizzle-orm');
  const dbConn = await getDb();
  const bankAccounts = await dbConn.select().from(bankAccountsTable).orderBy(asc(bankAccountsTable.locationId));
  console.log(`\nLocal bank accounts: ${bankAccounts.length}`);
  for (const ba of bankAccounts) {
    console.log(`  ${ba.name} (Location: ${ba.locationId}) - QBO ID: ${ba.qboAccountId || 'NOT SET'}`);
  }

  // Create missing accounts
  console.log('\n\n=== Creating Missing Accounts ===');

  if (!salesRevenue) {
    console.log('Creating Sales Revenue...');
    const result = await qbo.createAccount({
      name: 'Sales Revenue',
      accountType: 'Income',
      accountSubType: 'SalesOfProductIncome',
    });
    salesRevenue = result?.Account || result;
    console.log(`  Created: ID ${salesRevenue?.Id}`);
  }

  if (!gstPayable) {
    console.log('Creating GST Payable...');
    const result = await qbo.createAccount({
      name: 'GST Payable',
      accountType: 'Other Current Liability',
      accountSubType: 'OtherCurrentLiabilities',
    });
    gstPayable = result?.Account || result;
    console.log(`  Created: ID ${gstPayable?.Id}`);
  }

  if (!qstPayable) {
    console.log('Creating QST Payable...');
    const result = await qbo.createAccount({
      name: 'QST Payable',
      accountType: 'Other Current Liability',
      accountSubType: 'OtherCurrentLiabilities',
    });
    qstPayable = result?.Account || result;
    console.log(`  Created: ID ${qstPayable?.Id}`);
  }

  if (!tipsPayable) {
    console.log('Creating Tips Payable...');
    const result = await qbo.createAccount({
      name: 'Tips Payable',
      accountType: 'Other Current Liability',
      accountSubType: 'OtherCurrentLiabilities',
    });
    tipsPayable = result?.Account || result;
    console.log(`  Created: ID ${tipsPayable?.Id}`);
  }

  if (!merchantFees) {
    console.log('Creating Merchant Fees...');
    const result = await qbo.createAccount({
      name: 'Merchant Fees',
      accountType: 'Expense',
      accountSubType: 'OtherMiscellaneousServiceCost',
    });
    merchantFees = result?.Account || result;
    console.log(`  Created: ID ${merchantFees?.Id}`);
  }

  // Create bank accounts in QBO for each location
  console.log('\n=== Creating/Linking Bank Accounts in QBO ===');
  
  const locationBankMap = {};
  for (const ba of bankAccounts) {
    // Check if already has a valid QBO ID (not test-123)
    if (ba.qboAccountId && ba.qboAccountId !== 'test-123') {
      // Verify it exists in QBO
      const existing = accounts.find(a => a.Id === ba.qboAccountId);
      if (existing) {
        console.log(`  ✅ ${ba.name}: Already linked to QBO #${ba.qboAccountId} (${existing.Name})`);
        locationBankMap[ba.locationId] = ba.qboAccountId;
        continue;
      }
    }

    // Check if a matching bank account already exists in QBO
    const existingQbo = accounts.find(a => 
      a.AccountType === 'Bank' && 
      a.Name.toLowerCase().includes(ba.name.toLowerCase().split('-')[0].trim())
    );

    if (existingQbo) {
      console.log(`  🔗 ${ba.name}: Found existing QBO bank #${existingQbo.Id} (${existingQbo.Name})`);
      // Update local record
      await db.updateBankAccount(ba.id, { qboAccountId: existingQbo.Id });
      locationBankMap[ba.locationId] = existingQbo.Id;
    } else {
      // Create new bank account in QBO
      console.log(`  📝 ${ba.name}: Creating in QBO...`);
      try {
        const result = await qbo.createAccount({
          name: ba.name,
          accountType: 'Bank',
          accountSubType: 'Checking',
          accountNumber: ba.accountNumber || undefined,
        });
        const newAcct = result?.Account || result;
        const newId = newAcct?.Id;
        console.log(`     Created: QBO ID ${newId}`);
        await db.updateBankAccount(ba.id, { qboAccountId: newId });
        locationBankMap[ba.locationId] = newId;
      } catch (err) {
        console.log(`     ❌ Failed: ${err.message}`);
      }
    }
  }

  // Print final mapping
  console.log('\n\n=== FINAL ACCOUNT MAPPING ===');
  console.log(`Sales Revenue:  ID ${salesRevenue?.Id}`);
  console.log(`GST Payable:    ID ${gstPayable?.Id}`);
  console.log(`QST Payable:    ID ${qstPayable?.Id}`);
  console.log(`Tips Payable:   ID ${tipsPayable?.Id}`);
  console.log(`Merchant Fees:  ID ${merchantFees?.Id}`);
  console.log('Bank Accounts per Location:');
  for (const [locId, qboId] of Object.entries(locationBankMap)) {
    console.log(`  Location ${locId}: QBO Bank ID ${qboId}`);
  }

  // Save the mapping for the revenue JE script
  const mapping = {
    salesRevenue: { id: salesRevenue?.Id, name: salesRevenue?.Name || 'Sales Revenue' },
    gstPayable: { id: gstPayable?.Id, name: gstPayable?.Name || 'GST Payable' },
    qstPayable: { id: qstPayable?.Id, name: qstPayable?.Name || 'QST Payable' },
    tipsPayable: { id: tipsPayable?.Id, name: tipsPayable?.Name || 'Tips Payable' },
    merchantFees: { id: merchantFees?.Id, name: merchantFees?.Name || 'Merchant Fees' },
    bankByLocation: locationBankMap,
  };

  const fs = await import('fs');
  fs.writeFileSync('/tmp/qbo_account_mapping.json', JSON.stringify(mapping, null, 2));
  console.log('\nMapping saved to /tmp/qbo_account_mapping.json');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
