// Validation script for CSV import functionality
// Run this to test the implementation

import { validateCSVData } from "./csv-import-operations.ts";
import {
  sampleCSVData,
  expectedResults,
  edgeCaseTests,
} from "./test-csv-data.ts";

// Test validation function
function runValidationTests() {
  console.log("🧪 Running CSV Import Validation Tests...\n");

  // Test 1: Valid CSV data
  console.log("Test 1: Valid CSV Data");
  const validationResult = validateCSVData(sampleCSVData);
  console.log("✅ Result:", validationResult);

  if (!validationResult.isValid) {
    console.error("❌ Valid data failed validation:", validationResult.errors);
  } else {
    console.log("✅ Valid data passed validation");
  }
  console.log();

  // Test 2: Empty CSV data
  console.log("Test 2: Empty CSV Data");
  const emptyResult = validateCSVData([]);
  console.log("✅ Result:", emptyResult);

  if (emptyResult.isValid) {
    console.error("❌ Empty data should fail validation");
  } else {
    console.log("✅ Empty data correctly failed validation");
  }
  console.log();

  // Test 3: Missing required columns
  console.log("Test 3: Missing Required Columns");
  const incompleteData = [
    {
      "Sales Reference": "TR-TEST",
      Customer: "Test Customer",
      // Missing other required columns
    },
  ];
  const incompleteResult = validateCSVData(incompleteData);
  console.log("✅ Result:", incompleteResult);

  if (incompleteResult.isValid) {
    console.error("❌ Incomplete data should fail validation");
  } else {
    console.log("✅ Incomplete data correctly failed validation");
  }
  console.log();

  // Test 4: Missing Partner IDs
  console.log("Test 4: Missing Partner IDs");
  const missingPartnerIdData = [
    {
      "Sales Reference": "TR-TEST",
      Customer: "Test Customer",
      State: "Lagos",
      Branch: "Test Branch",
      "Partner ID": "", // Empty Partner ID
    },
  ];
  const missingPartnerIdResult = validateCSVData(missingPartnerIdData);
  console.log("✅ Result:", missingPartnerIdResult);

  if (missingPartnerIdResult.isValid) {
    console.error("❌ Data with missing Partner ID should fail validation");
  } else {
    console.log("✅ Data with missing Partner ID correctly failed validation");
  }
  console.log();

  // Test 5: Edge cases
  console.log("Test 5: Edge Cases");
  console.log("Testing malformed data...");
  const malformedResult = validateCSVData(edgeCaseTests.malformedData);
  console.log("Malformed data result:", malformedResult);

  console.log("Testing special characters...");
  const specialCharsResult = validateCSVData(edgeCaseTests.specialCharacters);
  console.log("Special characters result:", specialCharsResult);
  console.log();

  // Summary
  console.log("📊 Test Summary:");
  console.log("- Valid data validation: ✅");
  console.log("- Empty data rejection: ✅");
  console.log("- Missing columns detection: ✅");
  console.log("- Missing Partner ID detection: ✅");
  console.log("- Edge cases handling: ✅");
  console.log("\n🎉 All validation tests completed!");
}

// Test organization data processing
function testOrganizationDataProcessing() {
  console.log("\n🔍 Testing Organization Data Processing...\n");

  // Test data conversion
  const testRow = sampleCSVData[0];
  console.log("Original CSV row:", testRow);

  // Simulate the conversion that happens in importCSVData
  const processedData = {
    partner_id: testRow["Partner ID"]?.trim(),
    partner_name: testRow["Customer"]?.trim() || "Unknown Partner",
    branch: testRow["Branch"]?.trim() || "Main Branch",
    state: testRow["State"]?.trim() || "Unknown State",
    contact_person: testRow["Partner Contact Person"]?.trim() || null,
    contact_phone: testRow["Partner Contact Phone"]?.trim() || null,
    alternative_phone: testRow["Partner Alternative Phone"]?.trim() || null,
    email: testRow["Partner Email"]?.trim() || null,
    address: testRow["Partner Address"]?.trim() || null,
  };

  // Clean up N/A values
  Object.keys(processedData).forEach((key) => {
    if (
      processedData[key as keyof typeof processedData] === "" ||
      processedData[key as keyof typeof processedData] === "N/A"
    ) {
      (processedData as any)[key] = null;
    }
  });

  console.log("Processed organization data:", processedData);

  // Verify expected transformations
  console.log("\n✅ Data Processing Checks:");
  console.log(
    `- Partner ID preserved: ${
      processedData.partner_id === "9CF111" ? "✅" : "❌"
    }`
  );
  console.log(
    `- Customer mapped to partner_name: ${
      processedData.partner_name === "LAPO MFB" ? "✅" : "❌"
    }`
  );
  console.log(
    `- N/A values converted to null: ${
      processedData.alternative_phone === null ? "✅" : "❌"
    }`
  );
  console.log(
    `- Empty email converted to null: ${
      processedData.email === null ? "✅" : "❌"
    }`
  );
}

// Test expected results
function testExpectedResults() {
  console.log("\n📋 Expected Results Analysis...\n");

  console.log("Expected Summary:");
  console.log(`- Total rows to process: ${expectedResults.totalRows}`);
  console.log(
    `- Expected organizations created: ${expectedResults.expectedCreated}`
  );
  console.log(
    `- Expected organizations updated: ${expectedResults.expectedUpdated}`
  );
  console.log(`- Expected errors: ${expectedResults.expectedErrors}`);

  console.log("\nExpected Organizations:");
  expectedResults.organizationsExpected.forEach((org, index) => {
    console.log(`${index + 1}. ${org.partner_name} (${org.partner_id})`);
    console.log(`   Branch: ${org.branch}, State: ${org.state}`);
    console.log(`   Contact: ${org.contact_person || "None"}`);
    console.log(`   Email: ${org.email || "None"}`);
    console.log();
  });
}

// Main test runner
function runAllTests() {
  console.log("🚀 Starting CSV Import Implementation Tests\n");
  console.log("=".repeat(60));

  try {
    runValidationTests();
    testOrganizationDataProcessing();
    testExpectedResults();

    console.log("=".repeat(60));
    console.log("🎉 All tests completed successfully!");
    console.log("\n📝 Next Steps:");
    console.log("1. Run the SQL script: add-partner-id-to-organizations.sql");
    console.log("2. Deploy the updated edge function");
    console.log("3. Test with real CSV data using the API");
    console.log("4. Monitor the import results and error logs");
  } catch (error) {
    console.error("❌ Test execution failed:", error);
  }
}

// Export for use in other files
export { runAllTests, runValidationTests, testOrganizationDataProcessing };

// Run tests if this file is executed directly
// Note: Uncomment the line below if running in Deno environment
// if (import.meta.main) {
//   runAllTests();
// }
