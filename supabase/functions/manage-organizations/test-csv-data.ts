// Test data for CSV import functionality
// This file contains sample CSV data based on the user's requirements

export const sampleCSVData = [
  {
    "Sales Reference": "TR-4591A1",
    "Sales Date": "9/18/2025",
    Customer: "LAPO MFB",
    State: "Cross River",
    Branch: "OBUBRA",
    Quantity: "40",
    "Downloaded by": "ACSL Admin",
    "Stove IDs":
      "101034734, 101034900, 101026317, 101026318, 101034961, 101018066, 101015585, 101008449, 101008387, 101008297, 101008431, 101034758, 101008081, 101008409, 101018068, 101008450, 101008052, 101008191, 101008120, 101034739, 101021589, 101018084, 101008025, 101068221, 101008476, 101034944, 101008430, 101008375, 101015581, 101008220, 101034771, 101008402, 101015703, 101034942, 101018089, 101008169, 101034717, 101015584, 101008477, 101008032",
    "Sales Factory": "Asaba",
    "Sales Rep": "Ejiro Emeotu",
    "Partner ID": "9CF111",
    "Partner Address": "Mile 1 park by former first bank obubra",
    "Partner Contact Person": "ANIEFIOK UDO",
    "Partner Contact Phone": "7046023589",
    "Partner Alternative Phone": "N/A",
    "Partner Email": "N/A",
  },
  {
    "Sales Reference": "TR-4591A2",
    "Sales Date": "9/19/2025",
    Customer: "ABC Bank Limited",
    State: "Lagos",
    Branch: "VICTORIA ISLAND",
    Quantity: "25",
    "Downloaded by": "ACSL Admin",
    "Stove IDs": "101034735, 101034901, 101026319, 101026320, 101034962",
    "Sales Factory": "Lagos",
    "Sales Rep": "John Doe",
    "Partner ID": "ABC123",
    "Partner Address": "1234 Victoria Island, Lagos",
    "Partner Contact Person": "Jane Smith",
    "Partner Contact Phone": "08012345678",
    "Partner Alternative Phone": "08087654321",
    "Partner Email": "contact@abcbank.com",
  },
  {
    "Sales Reference": "TR-4591A3",
    "Sales Date": "9/20/2025",
    Customer: "XYZ Microfinance",
    State: "Kano",
    Branch: "KANO MAIN",
    Quantity: "15",
    "Downloaded by": "ACSL Admin",
    "Stove IDs": "101034736, 101034902, 101026321",
    "Sales Factory": "Kano",
    "Sales Rep": "Ahmad Musa",
    "Partner ID": "XYZ456",
    "Partner Address": "",
    "Partner Contact Person": "",
    "Partner Contact Phone": "",
    "Partner Alternative Phone": "",
    "Partner Email": "",
  },
  // Test duplicate Partner ID - should update existing
  {
    "Sales Reference": "TR-4591A4",
    "Sales Date": "9/21/2025",
    Customer: "LAPO MFB UPDATED",
    State: "Cross River",
    Branch: "CALABAR",
    Quantity: "30",
    "Downloaded by": "ACSL Admin",
    "Stove IDs": "101034737, 101034903",
    "Sales Factory": "Calabar",
    "Sales Rep": "Ejiro Emeotu",
    "Partner ID": "9CF111", // Same as first record - should update
    "Partner Address": "New Address in Calabar",
    "Partner Contact Person": "UPDATED CONTACT",
    "Partner Contact Phone": "08098765432",
    "Partner Alternative Phone": "08012349876",
    "Partner Email": "updated@lapomfb.com",
  },
  // Test missing Partner ID - should be skipped
  {
    "Sales Reference": "TR-4591A5",
    "Sales Date": "9/22/2025",
    Customer: "Invalid Organization",
    State: "Rivers",
    Branch: "PORT HARCOURT",
    Quantity: "10",
    "Downloaded by": "ACSL Admin",
    "Stove IDs": "101034738",
    "Sales Factory": "Port Harcourt",
    "Sales Rep": "Test Rep",
    "Partner ID": "", // Missing Partner ID - should fail
    "Partner Address": "Test Address",
    "Partner Contact Person": "Test Person",
    "Partner Contact Phone": "08011111111",
    "Partner Alternative Phone": "N/A",
    "Partner Email": "test@example.com",
  },
];

export const expectedResults = {
  totalRows: 5,
  expectedCreated: 3, // ABC123, XYZ456, and initial 9CF111
  expectedUpdated: 1, // 9CF111 update
  expectedErrors: 1, // Missing Partner ID
  organizationsExpected: [
    {
      partner_id: "9CF111",
      partner_name: "LAPO MFB UPDATED", // Should be updated value
      branch: "CALABAR", // Should be updated value
      state: "Cross River",
      contact_person: "UPDATED CONTACT",
      contact_phone: "08098765432",
      alternative_phone: "08012349876",
      email: "updated@lapomfb.com",
      address: "New Address in Calabar",
    },
    {
      partner_id: "ABC123",
      partner_name: "ABC Bank Limited",
      branch: "VICTORIA ISLAND",
      state: "Lagos",
      contact_person: "Jane Smith",
      contact_phone: "08012345678",
      alternative_phone: "08087654321",
      email: "contact@abcbank.com",
      address: "1234 Victoria Island, Lagos",
    },
    {
      partner_id: "XYZ456",
      partner_name: "XYZ Microfinance",
      branch: "KANO MAIN",
      state: "Kano",
      contact_person: null, // Empty string converted to null
      contact_phone: null,
      alternative_phone: null,
      email: null,
      address: null,
    },
  ],
};

// Test scenarios for edge cases
export const edgeCaseTests = {
  // Test with malformed data
  malformedData: [
    {
      "Sales Reference": "TR-MALFORMED",
      Customer: "", // Empty customer name - should fail validation
      State: "Lagos",
      Branch: "Test Branch",
      "Partner ID": "MALFORM1",
    },
  ],

  // Test with special characters
  specialCharacters: [
    {
      "Sales Reference": "TR-SPECIAL",
      Customer: "Test & Co. Ltd.",
      State: "Oyo",
      Branch: "Ibadan (Main)",
      "Partner ID": "SPEC@123",
      "Partner Contact Person": "O'Connor, John Jr.",
      "Partner Email": "test+tag@domain.co.uk",
    },
  ],

  // Test with very long names
  longNames: [
    {
      "Sales Reference": "TR-LONG",
      Customer: "A".repeat(150), // Exceeds 100 char limit - should fail
      State: "Lagos",
      Branch: "Test Branch",
      "Partner ID": "LONG123",
    },
  ],
};

// Helper function to generate test CSV with specified number of rows
export function generateLargeCSVTest(numRows: number): any[] {
  const data: any[] = [];
  for (let i = 1; i <= numRows; i++) {
    data.push({
      "Sales Reference": `TR-TEST${i.toString().padStart(4, "0")}`,
      "Sales Date": "10/2/2025",
      Customer: `Test Organization ${i}`,
      State: i % 2 === 0 ? "Lagos" : "Abuja",
      Branch: `Branch ${i}`,
      Quantity: (i * 10).toString(),
      "Downloaded by": "ACSL Admin",
      "Stove IDs": `10103${i.toString().padStart(4, "0")}`,
      "Sales Factory": i % 2 === 0 ? "Lagos" : "Abuja",
      "Sales Rep": `Rep ${i}`,
      "Partner ID": `TEST${i.toString().padStart(4, "0")}`,
      "Partner Address": `${i} Test Street, Test City`,
      "Partner Contact Person": `Contact Person ${i}`,
      "Partner Contact Phone": `080${i.toString().padStart(8, "0")}`,
      "Partner Alternative Phone": "N/A",
      "Partner Email": `contact${i}@test${i}.com`,
    });
  }
  return data;
}
