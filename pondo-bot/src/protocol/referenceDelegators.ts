import * as Aleo from '@demox-labs/aleo-sdk';

import {
  getPublicTransactionsForProgram,
  getLatestCommittee,
  getProgram,
  getMappingValue,
  isTransactionAccepted,
} from '../aleo/client';
import { deployProgram, deploymentCost, resolveImports } from '../aleo/deploy';
import { MemberData, ExecuteTransaction } from '../aleo/types';
import {
  pondoDependencyTree,
  pondoProgramToCode,
  pondoPrograms,
} from '../compiledPrograms';
import {
  formatAleoString,
  generateRandomCharacters,
  isProgramMatch,
} from '../util';
import { submitTransaction } from '../aleo/execute';
import {
  EPOCH_BLOCKS,
  NETWORK,
  MULTI_SIG_ADDRESS_0,
  MULTI_SIG_ADDRESS_1,
  MULTI_SIG_ADDRESS_2,
  MULTI_SIG_PRIVATE_KEY_0,
  MULTI_SIG_PRIVATE_KEY_1,
  MULTI_SIG_PRIVATE_KEY_2,
  PONDO_ORACLE_PROGRAM,
  PONDO_ORACLE_PROGRAM_CODE,
  PRIVATE_KEY,
  REFERENCE_DELEGATOR_ADMIN,
  CREDITS_PROGRAM,
} from '../constants';
``;

export const REFERENCE_DELEGATOR_PROGRAM = pondoPrograms.find((program) =>
  program.includes('reference_delegator')
);
const REFERENCE_DELEGATOR_PROGRAM_CODE =
  pondoProgramToCode[REFERENCE_DELEGATOR_PROGRAM!];

// Returns the addresses of the current validators
// that are eligible to be reference delegators
// (i.e. have a commission rate of less than 51% and are open to delegators)
const getEligibleMembers = (data: MemberData): string[] => {
  const eligibleMembers: string[] = [];

  for (const [address, [_, isActive, commission]] of Object.entries(
    data.members
  )) {
    if (isActive && commission < 51) {
      eligibleMembers.push(address);
    }
  }

  return eligibleMembers;
};

// Returns the current validators
const getCurrentValidators = async () => {
  const committeeState = await getLatestCommittee();
  return getEligibleMembers(committeeState);
};

// Returns the transaction history of all of the validators that were proposed as reference delegators
export const getOracleProposalTransactionHistory = async () => {
  const pondoOracleProgramId = pondoPrograms.filter((program) =>
    program.includes('validator_oracle')
  )[0];
  if (!pondoOracleProgramId) {
    throw new Error('Pondo oracle program not found');
  }
  return await getPublicTransactionsForProgram(
    pondoOracleProgramId,
    'propose_delegator',
    0
  );
};

export function extractValidatorAddressAndProgramName(tx: ExecuteTransaction): {
  validatorAddress: string | null;
  programName: string | null;
} {
  const transitions = tx.transaction.execution.transitions;
  let validatorAddress: string | null = null;
  let programName: string | null = null;

  for (const transition of transitions) {
    if (
      transition.program.includes('validator_oracle') &&
      transition.function === 'propose_delegator'
    ) {
      for (const input of transition.inputs) {
        if (input.type === 'public' && input.value.startsWith('aleo')) {
          validatorAddress = input.value;
        }
      }
    }
    if (
      transition.program.startsWith('reference_delegator') &&
      transition.function === 'initialize'
    ) {
      programName = transition.program;
    }
  }

  return { validatorAddress, programName };
}

// Updates the reference delegator program with the admin and validator addresses and a new program name
const updateReferenceDelegatorProgram = (
  program: string,
  adminAddress: string,
  validatorAddress: string
) => {
  const adminPlaceholder =
    'aleo12shtwnmf49t5atmad2jnk3e58ahtp749d9trctt9z3wryxyzt5pspp0nd0';
  const validatorPlaceholder =
    'aleo1j0zju7f0fpgv98gulyywtkxk6jca99l6425uqhnd5kccu4jc2grstjx0mt';

  // Replace admin and validator addresses
  let updatedProgram = program.replace(
    new RegExp(adminPlaceholder, 'g'),
    adminAddress
  );
  updatedProgram = updatedProgram.replace(
    new RegExp(validatorPlaceholder, 'g'),
    validatorAddress
  );

  // Generate 6 random characters
  const randomCharacters = generateRandomCharacters(6);

  // Replace the program name
  const updatedProgramId = `reference_delegator${randomCharacters}.aleo`;
  updatedProgram = updatedProgram.replaceAll(
    /reference_delegator\.aleo/g,
    updatedProgramId
  );

  return { updatedProgram, updatedProgramId };
};

const deployReferenceDelegator = async (validatorAddress: string) => {
  // Get the address of the admin
  const address = REFERENCE_DELEGATOR_ADMIN;

  // Get the reference delegator program
  const referenceDelegatorProgramId = pondoPrograms.filter((program) =>
    program.includes('reference_delegator')
  )[0];
  if (!referenceDelegatorProgramId) {
    throw new Error('Reference delegator program not found');
  }

  const referenceDelegatorProgram =
    pondoProgramToCode[referenceDelegatorProgramId];
  const imports = pondoDependencyTree[referenceDelegatorProgramId];
  let resolvedImports = {};
  if (imports) {
    resolvedImports = await resolveImports(imports);
  }

  // Update the reference delegator program with the admin and validator addresses
  const { updatedProgram, updatedProgramId } = updateReferenceDelegatorProgram(
    referenceDelegatorProgram,
    address,
    validatorAddress
  );
  console.log(updatedProgram);
  // Deploy the reference delegator
  console.log(
    `Deploying program ${updatedProgramId} for validator ${validatorAddress}`
  );
  let fee = deploymentCost(referenceDelegatorProgramId);
  await deployProgram(
    NETWORK,
    PRIVATE_KEY,
    updatedProgram,
    resolvedImports,
    fee
  );

  console.log(`Reference delegator deployed for validator ${validatorAddress}`);
  return {
    program: updatedProgram,
    programId: updatedProgramId,
    imports: resolvedImports,
  };
};

// Initializes the reference delegator program
const initializeReferenceDelegator = async (
  program: string,
  imports: { [key: string]: string }
) => {
  console.log('Initializing reference delegator');
  await submitTransaction(
    NETWORK,
    PRIVATE_KEY,
    program,
    'initialize',
    [],
    0.284921,
    undefined,
    imports
  );
};

// Deploys the reference delegators if they haven't been deployed yet
export const deployReferenceDelegatorsIfNecessary = async () => {
  const currentValidators = await getCurrentValidators();
  console.log('Current validators:', JSON.stringify(currentValidators));
  const transactionHistory = await getOracleProposalTransactionHistory();
  const delegatorsAndValidators = transactionHistory.map((tx) =>
    extractValidatorAddressAndProgramName(tx)
  );
  console.log(
    'Delegators and validators:',
    JSON.stringify(delegatorsAndValidators)
  );

  console.log('Deploying reference delegators');
  for (const validator of currentValidators) {
    const validatorAndDelegator = delegatorsAndValidators.find(
      ({ validatorAddress }) => validatorAddress === validator
    );
    if (validatorAndDelegator) {
      const { validatorAddress, programName } = validatorAndDelegator;
      const programCode = await getProgram(programName);
      const programAddress = Aleo.Program.fromString(
        NETWORK,
        programCode
      ).toAddress();
      console.log(
        `Reference delegator ${programName} ${programAddress} already deployed for validator ${validator}`
      );
      continue;
    }
    const { program, imports } = await deployReferenceDelegator(validator);
    await initializeReferenceDelegator(program, imports);
  }
};

export const approveReferenceDelegatorsIfNecessary = async () => {
  console.log('Approving reference delegators');

  const transactionHistory = await getOracleProposalTransactionHistory();
  const delegatorsAndValidators = transactionHistory.map((tx) =>
    extractValidatorAddressAndProgramName(tx)
  );

  // For each reference delegator, check if they've been approved and approve them if they haven't
  for (const { validatorAddress, programName } of delegatorsAndValidators) {
    if (!validatorAddress) {
      continue;
    }

    const programCode = await getProgram(programName);
    if (!programCode) {
      console.log(`Program ${programName} not found`);
      continue;
    }
    const programAddress = Aleo.Program.fromString(
      NETWORK,
      programCode
    ).toAddress();
    const matchesSpecification =
      isProgramMatch(REFERENCE_DELEGATOR_PROGRAM_CODE, programCode) &&
      programCode.includes(validatorAddress);

    if (!matchesSpecification) {
      console.log(
        `Reference delegator ${programName} does not match the specification`
      );
      continue;
    }

    const isAlreadyApproved = await getMappingValue(
      programAddress,
      PONDO_ORACLE_PROGRAM,
      'validator_data'
    );

    if (isAlreadyApproved) {
      console.log(`Reference delegator ${programName} already approved`);
      continue;
    }

    let imports = pondoDependencyTree[PONDO_ORACLE_PROGRAM];
    let resolvedImports = await resolveImports(imports);

    // Get a random bigint to use as the requestId
    const requestId = BigInt(Math.floor(Math.random() * 1_000_000_000));
    const addressHash = Aleo.Plaintext.fromString(
      NETWORK,
      programAddress
    ).hashBhp256();
    const plaintextString = `{
      arg: ${addressHash},
      op_type: 4u8,
      request_id: ${requestId}u64
    }`;
    const hashedField = Aleo.Plaintext.fromString(
      NETWORK,
      plaintextString
    ).hashBhp256();

    // Sign the hash with the oracle private keys
    const signature0 = Aleo.Signature.sign_plaintext(
      NETWORK,
      MULTI_SIG_PRIVATE_KEY_0,
      hashedField
    ).to_string();
    const signature1 = Aleo.Signature.sign_plaintext(
      NETWORK,
      MULTI_SIG_PRIVATE_KEY_1,
      hashedField
    ).to_string();
    const signature2 = Aleo.Signature.sign_plaintext(
      NETWORK,
      MULTI_SIG_PRIVATE_KEY_2,
      hashedField
    ).to_string();

    console.log(`Approving reference delegator ${programName}`);
    const txResult = await submitTransaction(
      NETWORK,
      PRIVATE_KEY,
      PONDO_ORACLE_PROGRAM_CODE,
      'add_delegator',
      [
        programAddress,
        signature0,
        MULTI_SIG_ADDRESS_0,
        signature1,
        MULTI_SIG_ADDRESS_1,
        signature2,
        MULTI_SIG_ADDRESS_2,
        `${requestId.toString()}u64`,
      ],
      3,
      undefined,
      resolvedImports
    );

    const transactionAccepted = await isTransactionAccepted(txResult);
    console.log(
      `Approved ${programAddress} Transaction accepted: ${transactionAccepted}`
    );
  }
};

const updateReferenceDelegatorIfNecessary = async (
  blockHeight: number,
  delegator: string
): Promise<void> => {
  const currentlyActive = await getMappingValue(
    delegator,
    PONDO_ORACLE_PROGRAM,
    'validator_data'
  );
  if (currentlyActive) {
    const validatorData = JSON.parse(formatAleoString(currentlyActive));
    const lastUpdate =
      BigInt(validatorData['block_height'].slice(0, -3)) / BigInt(EPOCH_BLOCKS);
    const currentEpoch = BigInt(blockHeight) / BigInt(EPOCH_BLOCKS);
    if (lastUpdate >= currentEpoch) {
      console.log(
        `Current delegator ${formatAleoString(
          currentlyActive
        )} has already been updated in this epoch, skipping`
      );
      return;
    }

    const stillBonded = await getMappingValue(
      delegator,
      CREDITS_PROGRAM,
      'bonded'
    );
    if (!stillBonded) {
      console.log(
        `Reference delegator ${delegator} is no longer bonded, skipping`
      );
      return;
    }

    const validatorAddress = validatorData['validator'];
    const isBanned = await getMappingValue(
      validatorAddress,
      PONDO_ORACLE_PROGRAM,
      'banned_validators'
    );
    if (isBanned) {
      console.log(
        `Reference delegator ${delegator} is bonded to a banned validator (${validatorAddress}), skipping`
      );
      return;
    }

    const committeeState = await getLatestCommittee();
    const eligibleMembers = getEligibleMembers(committeeState);
    if (!eligibleMembers.includes(validatorAddress)) {
      console.log(
        `Reference delegator ${delegator} is bonded to a validator (${validatorAddress}) that is no longer eligible, skipping`
      );
      return;
    }
  }

  console.log(`Updating ${delegator} reference delegator data`);
  let imports = pondoDependencyTree[PONDO_ORACLE_PROGRAM];
  let resolvedImports = await resolveImports(imports);

  await submitTransaction(
    NETWORK,
    PRIVATE_KEY,
    PONDO_ORACLE_PROGRAM_CODE,
    'update_data',
    [delegator],
    4, // TODO: set the correct fee
    undefined,
    resolvedImports
  );
};

export const updateReferenceDelegatorsIfNecessary = async (
  blockHeight: number
) => {
  console.log('Updating reference delegators data if necessary');

  const transactionHistory = (await getPublicTransactionsForProgram(
    PONDO_ORACLE_PROGRAM,
    'add_delegator',
    0
  )) as ExecuteTransaction[];
  const delegators = transactionHistory.map(
    (tx) => tx.transaction.execution.transitions[0].inputs[0].value
  );
  console.log('Delegators:', JSON.stringify(delegators));

  const updatePromises = delegators.map((delegator) =>
    updateReferenceDelegatorIfNecessary(blockHeight, delegator)
  );
  await Promise.all(updatePromises);
};

export const calculateReferenceDelegatorYield = (
  startBlock: bigint,
  endBlock: bigint,
  startMicrocredits: bigint,
  endMicrocredits: bigint
): bigint => {
  const blocks = endBlock - startBlock;
  const delegatorYield =
    ((endMicrocredits - startMicrocredits) * BigInt(10_000_000_000)) /
    startMicrocredits;
  return (delegatorYield * BigInt(EPOCH_BLOCKS)) / blocks;
};
