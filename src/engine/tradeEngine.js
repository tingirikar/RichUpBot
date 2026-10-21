import { GROUP_TILES, BOARD_TILES, GROUP_POWER } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OpponentTracker } from '../memory/opponentTracker.js';
import { CONFIG } from '../config.js';
import { logToBot } from '../dom/actionExecutor.js';

/**
 * GAME-THEORETIC MINIMAX TRADE ENGINE
 * 
 * 1. Evaluates incoming trades using synergy multipliers & cash differentials
 * 2. Scans board for Mutual Monopoly Swaps
 * 3. Prevents giving opponents uncountered monopolies
 * 4. Formulates win-win trades with custom chat pitches
 */
export const TradeEngine = {
    scoreTileForPlayer(tile, playerName) {
        if (!tile) return 0;
        const powerMult = tile.group && GROUP_POWER[tile.group] ? (GROUP_POWER[tile.group] / 50) : 1.0;
        const baseEV = tile.price * (1 + tile.markov * 18) * powerMult;
        if (!tile.group) return Math.round(baseEV);

        const isMe = GameMemory.isMe(playerName);
        const { owned, total } = GameMemory.getGroupCount(tile.group, isMe ? '__ME__' : playerName);

        let synergy = 1.0;
        if (tile.type === 'property') {
            if (owned >= total - 1) synergy = 6.2; // Massive monopoly synergy
            else if (owned === 1 && total === 3) synergy = 2.0;
        } else if (tile.type === 'airport') {
            synergy = 1.0 + owned * 0.45;
        } else if (tile.type === 'utility') {
            synergy = owned >= 1 ? 1.8 : 0.9;
        }
        return Math.round(baseEV * synergy);
    },

    /**
     * 20-ROUND MONTE CARLO FORWARD TRADE SIMULATION
     * Simulates up to 20 rounds of future dice rolls, rent payments, salary collection,
     * and bankruptcy risk comparing trade ACCEPTED vs REJECTED.
     */
    simulateFutureTradeRounds(tradeData, numRounds = 20, iterations = 80) {
        const {
            partnerName = '__OPP__',
            givenTiles = [],
            receivedTiles = [],
            givenCash = 0,
            receivedCash = 0
        } = tradeData;

        const givenIds = new Set(givenTiles.map(t => t.id));
        const receivedIds = new Set(receivedTiles.map(t => t.id));

        const runTrajectory = (isAccepted) => {
            // Copy ownership state
            const simOwnership = {};
            for (const [id, info] of Object.entries(GameMemory.ownership)) {
                let owner = info.owner;
                if (isAccepted) {
                    if (givenIds.has(Number(id))) owner = partnerName;
                    if (receivedIds.has(Number(id))) owner = GameMemory.myName || '__ME__';
                }
                simOwnership[id] = { owner, houses: info.houses || 0, mortgaged: info.mortgaged || false };
            }

            let myCash = isAccepted ? (GameMemory.myCash - givenCash + receivedCash) : GameMemory.myCash;
            let oppBase = GameMemory.players[partnerName]?.cash ?? 500;
            let oppCash = isAccepted ? (oppBase - receivedCash + givenCash) : oppBase;

            let myPos = GameMemory.myPos || 0;
            let oppPos = GameMemory.players[partnerName]?.pos || 0;

            let myBankrupt = myCash < 0;
            let oppBankrupt = oppCash < 0;

            for (let r = 1; r <= numRounds; r++) {
                // Player My Turn
                if (!myBankrupt) {
                    const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
                    const newPos = (myPos + roll) % 40;
                    if (newPos < myPos) myCash += 200; // Salary for passing GO
                    myPos = newPos;

                    const tile = BOARD_TILES[myPos];
                    if (tile?.group) {
                        const info = simOwnership[tile.id];
                        if (info?.owner === partnerName && !info.mortgaged) {
                            let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                            if (tile.type === 'property' && tile.rent) {
                                rent = tile.rent[info.houses || 0] || tile.rent[0];
                                if ((info.houses || 0) === 0 && tile.group) {
                                    const gTiles = GROUP_TILES[tile.group] || [];
                                    if (gTiles.length > 0 && gTiles.every(gt => simOwnership[gt.id]?.owner === partnerName)) {
                                        rent *= 2;
                                    }
                                }
                            } else if (tile.type === 'airport') {
                                const count = Object.values(simOwnership).filter(x => x.owner === partnerName && BOARD_TILES[x.id]?.type === 'airport').length;
                                rent = 25 * Math.pow(2, Math.max(0, count - 1));
                            }
                            myCash -= rent;
                            oppCash += rent;
                            if (myCash < 0) myBankrupt = true;
                        }
                    }
                }

                // Opponent Turn
                if (!oppBankrupt) {
                    const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
                    const newPos = (oppPos + roll) % 40;
                    if (newPos < oppPos) oppCash += 200;
                    oppPos = newPos;

                    const tile = BOARD_TILES[oppPos];
                    if (tile?.group) {
                        const info = simOwnership[tile.id];
                        if (info && GameMemory.isMe(info.owner) && !info.mortgaged) {
                            let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                            if (tile.type === 'property' && tile.rent) {
                                rent = tile.rent[info.houses || 0] || tile.rent[0];
                                if ((info.houses || 0) === 0 && tile.group) {
                                    const gTiles = GROUP_TILES[tile.group] || [];
                                    if (gTiles.length > 0 && gTiles.every(gt => GameMemory.isMe(simOwnership[gt.id]?.owner))) {
                                        rent *= 2;
                                    }
                                }
                            } else if (tile.type === 'airport') {
                                const count = Object.values(simOwnership).filter(x => GameMemory.isMe(x.owner) && BOARD_TILES[x.id]?.type === 'airport').length;
                                rent = 25 * Math.pow(2, Math.max(0, count - 1));
                            }
                            oppCash -= rent;
                            myCash += rent;
                            if (oppCash < 0) oppBankrupt = true;
                        }
                    }
                }
            }

            return { myCash, oppCash, mySurvive: !myBankrupt, oppSurvive: !oppBankrupt };
        };

        let accSurvivals = 0, accCashSum = 0;
        let rejSurvivals = 0, rejCashSum = 0;

        for (let i = 0; i < iterations; i++) {
            const acc = runTrajectory(true);
            if (acc.mySurvive) accSurvivals++;
            accCashSum += acc.myCash;

            const rej = runTrajectory(false);
            if (rej.mySurvive) rejSurvivals++;
            rejCashSum += rej.myCash;
        }

        const accSurvRate = Math.round((accSurvivals / iterations) * 100);
        const rejSurvRate = Math.round((rejSurvivals / iterations) * 100);
        const accAvgCash = Math.round(accCashSum / iterations);
        const avgRejCash = Math.round(rejCashSum / iterations);

        return {
            simulatedRounds: numRounds,
            iterations,
            accSurvRate,
            rejSurvRate,
            accAvgCash,
            avgRejCash,
            isSimulationEVPlus: accAvgCash >= avgRejCash && accSurvRate >= (rejSurvRate - 10)
        };
    },

    findCounterTrade(tradeData) {
        const { partnerName, givenTiles = [], receivedTiles = [] } = tradeData;
        if (!partnerName || partnerName === 'Opponent') return null;

        const myMissing = OpponentTracker.getMyMissingCards();
        const partnerMissingCard = myMissing.find(m => m.heldBy && m.heldBy.toLowerCase() === partnerName.toLowerCase());

        if (partnerMissingCard && partnerMissingCard.missingTile) {
            // Find a tile to offer: prefer the tile they asked for, or an unmortgaged safe sacrifice
            const requestedTile = givenTiles[0] || OpponentTracker.getSafeTradeSacrifices()[0]?.tile;
            if (requestedTile) {
                const oppSet = requestedTile.group ? GameMemory.getGroupCount(requestedTile.group, partnerName) : null;
                const givesThemMonopoly = oppSet && oppSet.owned === oppSet.total - 1;

                const oppCash = GameMemory.players[partnerName]?.cash ?? 500;
                let cashDemand = 0;
                if (givesThemMonopoly) {
                    const myPower = GROUP_POWER[partnerMissingCard.missingTile.group] || 50;
                    const oppPower = GROUP_POWER[requestedTile.group] || 50;
                    const powerDeficit = oppPower - myPower;
                    if (powerDeficit > 0) {
                        cashDemand = Math.min(oppCash, Math.max(100, Math.round(powerDeficit * 8)));
                    } else {
                        cashDemand = Math.max(0, Math.min(Math.max(0, oppCash - 50), 100));
                    }
                }

                const cashDemandStr = cashDemand > 0 ? ` + $${cashDemand}` : '';
                return {
                    targetOwner: partnerName,
                    myGivenTile: requestedTile,
                    myReceivedTile: partnerMissingCard.missingTile,
                    cashOffer: 0,
                    cashDemand,
                    summary: `COUNTER: Give ${requestedTile.name} -> Get ${partnerMissingCard.missingTile.name}${cashDemandStr}`,
                    pitch: `counter: ${partnerMissingCard.missingTile.name.toLowerCase()} for ${requestedTile.name.toLowerCase()}`,
                    reason: `Grandmaster Counter-Proposal: Securing ${partnerMissingCard.missingTile.name} to complete our ${partnerMissingCard.missingTile.group} Monopoly!`
                };
            }
        }
        return null;
    },

    evaluateIncomingTrade(tradeData) {
        const {
            partnerName = '__OPP__',
            givenTiles = [],
            receivedTiles = [],
            givenCash = 0,
            receivedCash = 0
        } = tradeData;

        // Check our current monopoly status (Phase 1: Need monopoly vs Phase 2: Already hold monopoly)
        const myExistingMonopolies = [];
        for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
            if (groupName === 'Airport' || groupName === 'Utility') continue;
            if (groupTiles.every(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner))) {
                myExistingMonopolies.push(groupName);
            }
        }
        const weAlreadyHaveMonopoly = myExistingMonopolies.length > 0;

        // VETO CHECK 1: Detect if trade completes an opponent monopoly
        let givesOppMonopoly = false;
        let oppGroupName = '';
        let givenBlockerTile = null;

        for (const tile of givenTiles) {
            if (tile.group && tile.type === 'property') {
                const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
                if (oppSet.owned === oppSet.total - 1) {
                    givesOppMonopoly = true;
                    oppGroupName = tile.group;
                    givenBlockerTile = tile;
                    break;
                }
            }
        }

        // Detect if trade gives opponent >= 2 tiles in a color group (advancement toward monopoly)
        let givesOppAdvancement = false;
        let oppAdvanceGroup = '';
        for (const tile of givenTiles) {
            if (tile.group && tile.type === 'property') {
                const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
                if (oppSet.owned >= 1) {
                    givesOppAdvancement = true;
                    oppAdvanceGroup = tile.group;
                    break;
                }
            }
        }

        // Detect if trade completes a monopoly for us
        let completesMyMonopoly = false;
        let myCompletedGroup = '';
        for (const tile of receivedTiles) {
            if (tile.group && tile.type === 'property') {
                const mySet = GameMemory.getGroupCount(tile.group, '__ME__');
                if (mySet.owned === mySet.total - 1) {
                    completesMyMonopoly = true;
                    myCompletedGroup = tile.group;
                    break;
                }
            }
        }

        // FATAL DANGER CHECK: Opponent gets a set, we do NOT!
        // No amount of money compensates for handing an opponent a monopoly.
        if (givesOppMonopoly && !completesMyMonopoly) {
            const counter = this.findCounterTrade(tradeData);
            if (counter) {
                return {
                    accept: false,
                    counterSwap: counter,
                    reason: `FATAL DANGER VETO: Gives ${partnerName} a ${oppGroupName} monopoly while we get none! (Money cannot compensate for a monopoly).`,
                    chatReply: CONFIG.CHAT_ENABLED ? `counter me with ${counter.myReceivedTile.name.toLowerCase()}` : null
                };
            }
            return {
                accept: false,
                counterSwap: null,
                reason: `FATAL DANGER VETO: Gives ${partnerName} a ${oppGroupName} monopoly while we get none! (Money cannot compensate for a monopoly).`,
                chatReply: CONFIG.CHAT_ENABLED ? `cant give u a set sry` : null
            };
        }

        // POST-MONOPOLY STARVATION STRATEGY:
        // We already own a monopoly! Our #1 objective is building houses and starving opponents.
        // We refuse to sell/trade any property unless we receive an immediate 2nd completed monopoly!
        if (weAlreadyHaveMonopoly && !completesMyMonopoly && givenTiles.length > 0) {
            const counter = this.findCounterTrade(tradeData);
            return {
                accept: false,
                counterSwap: counter,
                reason: `POST-MONOPOLY STARVATION VETO: We already own ${myExistingMonopolies.join(', ')}. Holding all properties/blockers to starve opponents until we secure a 2nd monopoly!`,
                chatReply: CONFIG.CHAT_ENABLED ? `already have my set, only trading for 2nd set` : null
            };
        }

        // BLOCKER & ADVANCEMENT VETO (Pre-monopoly):
        // If giving this tile advances opponent toward a monopoly (giving them 2-of-3) while we get no set, veto!
        if (!weAlreadyHaveMonopoly && givesOppAdvancement && !completesMyMonopoly) {
            const counter = this.findCounterTrade(tradeData);
            return {
                accept: false,
                counterSwap: counter,
                reason: `BLOCKER VETO: Trade advances ${partnerName} toward a ${oppAdvanceGroup} monopoly while we get no set!`,
                chatReply: CONFIG.CHAT_ENABLED ? (counter ? `counter me with ${counter.myReceivedTile.name.toLowerCase()}` : `cant give u that sry`) : null
            };
        }

        // CASH-ONLY VETO: Never liquidate property for cash alone! Properties are irreplaceable.
        if (receivedTiles.length === 0 && givenTiles.length > 0) {
            return {
                accept: false,
                counterSwap: null,
                reason: `CASH-ONLY VETO: Never sell board presence for cash alone. Properties are irreplaceable.`,
                chatReply: CONFIG.CHAT_ENABLED ? `not selling properties for cash sry` : null
            };
        }

        // MONOPOLY EVALUATION: Securing completed monopolies is the #1 winning condition!
        if (completesMyMonopoly) {
            const myCashAfter = GameMemory.myCash + receivedCash - givenCash;
            if (myCashAfter < 30) {
                // Only decline if the cash terms literally leave us bankrupt
                return {
                    accept: false,
                    counterSwap: this.findCounterTrade(tradeData),
                    reason: `MONOPOLY BLOCKED BY DEBT: Trade completes ${myCompletedGroup} but leaves only $${myCashAfter} cash!`,
                    chatReply: CONFIG.CHAT_ENABLED ? `id be broke lol add cash` : null
                };
            }

            if (givesOppMonopoly) {
                // BOTH PLAYERS GET A SET! Mutual Monopoly Swap!
                // Evaluate relative Country Power to ensure we are not committing strategic suicide:
                const myPower = GROUP_POWER[myCompletedGroup] || 50;
                const oppPower = GROUP_POWER[oppGroupName] || 50;
                const powerDiff = myPower - oppPower; // positive = we are stronger, negative = they are stronger
                const netCash = receivedCash - givenCash;

                if (powerDiff > 5) {
                    // WE GET THE SUPERIOR SET! (e.g. Germany vs Italy/Brazil)
                    if (netCash >= -100) {
                        return {
                            accept: true,
                            myGain: 4000 + powerDiff * 25,
                            oppGain: 2500,
                            reason: `DOMINANT MUTUAL MONOPOLY SWAP: Our ${myCompletedGroup} (Power ${myPower}) dominates their ${oppGroupName} (Power ${oppPower})!`,
                            chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
                        };
                    }
                } else if (Math.abs(powerDiff) <= 5) {
                    // EQUAL TIER SETS! (e.g. Germany vs China, or France vs USA)
                    if (netCash >= -50) {
                        return {
                            accept: true,
                            myGain: 3500,
                            oppGain: 3500,
                            reason: `BALANCED MUTUAL MONOPOLY SWAP: Both players get equal-tier sets (${myCompletedGroup} vs ${oppGroupName}).`,
                            chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
                        };
                    }
                } else {
                    // THEY GET THE STRONGER SET! (e.g. They get Germany/China, we get Brazil/Israel/Italy)
                    // We require cash compensation to balance the lethality deficit and finance our houses immediately!
                    const requiredCashBonus = Math.round(Math.abs(powerDiff) * 8);

                    if (netCash >= requiredCashBonus) {
                        return {
                            accept: true,
                            myGain: 3200 + netCash,
                            oppGain: 3500,
                            reason: `COMPENSATED MUTUAL MONOPOLY SWAP: ${oppGroupName} (Power ${oppPower}) is stronger than ${myCompletedGroup} (Power ${myPower}), but compensated by +$${netCash} cash!`,
                            chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
                        };
                    } else {
                        // DEFICIT VETO!
                        const counter = this.findCounterTrade(tradeData);
                        return {
                            accept: false,
                            counterSwap: counter,
                            reason: `INFERIOR SET VETO: ${oppGroupName} (Power ${oppPower}) is significantly more lethal than ${myCompletedGroup} (Power ${myPower}). Needs at least +$${requiredCashBonus} cash bonus to balance building power!`,
                            chatReply: CONFIG.CHAT_ENABLED ? `need $${requiredCashBonus}+ cash, ${oppGroupName.toLowerCase()} is way stronger` : null
                        };
                    }
                }
            } else {
                // WE GET A MONOPOLY, OPPONENT GETS NONE! Overwhelming advantage!
                return {
                    accept: true,
                    myGain: 5000,
                    oppGain: 500,
                    reason: `MONOPOLY COMPLETER: Completes our ${myCompletedGroup} monopoly without giving opponent a set!`,
                    chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
                };
            }
        }

        // Calculate utility gains
        let myGain = receivedCash - givenCash;
        let oppGain = givenCash - receivedCash;

        for (const tile of receivedTiles) {
            myGain += this.scoreTileForPlayer(tile, '__ME__');
            oppGain -= this.scoreTileForPlayer(tile, partnerName);
        }
        for (const tile of givenTiles) {
            myGain -= this.scoreTileForPlayer(tile, '__ME__');
            oppGain += this.scoreTileForPlayer(tile, partnerName);
        }

        // 20-Round Forward Rollout Simulation Check
        const sim = this.simulateFutureTradeRounds(tradeData, 20, 80);

        // Simulation Veto: If accepting the trade crashes our 20-round survival rate
        if (sim.accSurvRate < sim.rejSurvRate - 10) {
            return {
                accept: false,
                counterSwap: null,
                reason: `20-ROUND SIMULATION VETO: Accepting drops 20-round survival from ${sim.rejSurvRate}% to ${sim.accSurvRate}%!`,
                chatReply: CONFIG.CHAT_ENABLED ? `nah sry` : null
            };
        }

        // UNFAIR DEFICIT CHECK: Never accept a trade in the opponent's favor!
        if (oppGain > myGain && !completesMyMonopoly) {
            const counter = this.findCounterTrade(tradeData);
            if (counter) {
                return {
                    accept: false,
                    counterSwap: counter,
                    reason: `UNFAIR DEFICIT: Trade favors ${partnerName}. Countering for set completer.`,
                    chatReply: CONFIG.CHAT_ENABLED ? `counter me` : null
                };
            }

            return {
                accept: false,
                counterSwap: null,
                reason: `UNFAIR DEFICIT: Trade favors ${partnerName} by +$${Math.round(oppGain - myGain)}.`,
                chatReply: CONFIG.CHAT_ENABLED ? "nah sry" : null
            };
        }

        // Final sanity check: If it doesn't complete our monopoly, and gives them any advantage, reject!
        const acceptable = myGain > 0 && 
            (completesMyMonopoly || (!weAlreadyHaveMonopoly && myGain >= oppGain * CONFIG.TRADE_MIN_ADVANTAGE_RATIO)) && 
            sim.isSimulationEVPlus;

        GameMemory.lastTradeVerdict = acceptable ? 'ACCEPTABLE' : 'UNFAVORABLE';

        return {
            accept: acceptable,
            myGain: Math.round(myGain),
            oppGain: Math.round(oppGain),
            sim20Rounds: sim,
            counterSwap: acceptable ? null : this.findCounterTrade(tradeData),
            reason: acceptable
                ? `GRANDMASTER EV+ TRADE: Net gain +$${Math.round(myGain)} vs Opp +$${Math.round(oppGain)} (20-turn Sim: +EV)`
                : `Unfavorable utility: Net gain $${Math.round(myGain)} < requirement`,
            chatReply: CONFIG.CHAT_ENABLED ? (acceptable ? "deal thx" : "nah sry") : null
        };
    },

    /**
     * Proactively scans board state for win-win trade opportunities:
     * 1. Mutual Monopoly Swaps (both players complete sets)
     * 2. Monopoly Completing Acquisitions (we offer cash + surplus properties to get our 3rd card!)
     */
    scanMutualMonopolySwaps() {
        const opportunities = [];
        const myMissing = OpponentTracker.getMyMissingCards();
        const opponents = OpponentTracker.analyzeOpponents();
        const safeSacrifices = OpponentTracker.getSafeTradeSacrifices();

        const myExistingMonopolies = [];
        for (const [groupName, groupTiles] of Object.entries(GROUP_TILES)) {
            if (groupName === 'Airport' || groupName === 'Utility') continue;
            if (groupTiles.every(t => GameMemory.isMe(GameMemory.ownership[t.id]?.owner))) {
                myExistingMonopolies.push(groupName);
            }
        }
        const weAlreadyHaveMonopoly = myExistingMonopolies.length > 0;

        // 1. MUTUAL MONOPOLY SWAPS (Both get sets)
        for (const myNeed of myMissing) {
            if (myNeed.isUnowned) continue;

            const targetOpponents = myNeed.heldBy 
                ? [myNeed.heldBy] 
                : Object.keys(GameMemory.players).filter(p => !GameMemory.isMe(p) && !GameMemory.players[p]?.bankrupt);

            for (const targetOppName of targetOpponents) {
                const targetOpp = opponents[targetOppName];
                if (!targetOpp) continue;

                for (const oppNeed of targetOpp.hungrySets) {
                    if (oppNeed.weHoldIt && oppNeed.missingTile) {
                        const myCardValue = this.scoreTileForPlayer(oppNeed.missingTile, targetOppName);
                        const theirCardValue = this.scoreTileForPlayer(myNeed.missingTile, '__ME__');

                        const myPower = GROUP_POWER[myNeed.missingTile.group] || 50;
                        const oppPower = GROUP_POWER[oppNeed.missingTile.group] || 50;
                        const powerDiff = myPower - oppPower; // positive = we receive stronger set, negative = we give stronger set

                        let cashOffer = 0;
                        let cashDemand = 0;

                        if (powerDiff > 5) {
                            // We are asking for a stronger set (e.g. we want Germany, offering them Italy).
                            // Offer cash to incentivize them:
                            const cashAvailable = weAlreadyHaveMonopoly 
                                ? Math.max(0, GameMemory.myCash - 350)
                                : Math.max(0, GameMemory.myCash - 150);
                            cashOffer = Math.min(cashAvailable, Math.round(powerDiff * 6));
                        } else if (powerDiff < -5) {
                            // We are offering a stronger set (e.g. we offer Germany, asking for Italy/Brazil).
                            // Demand cash to compensate for giving away a deadly set!
                            cashDemand = Math.min(targetOpp.cash, Math.round(Math.abs(powerDiff) * 8));
                        } else {
                            // Equal tier: fall back on asset valuation diff
                            const cashDiff = myCardValue - theirCardValue;
                            if (cashDiff > 0) {
                                cashDemand = Math.min(targetOpp.cash, Math.round(cashDiff * 0.4));
                            } else if (cashDiff < 0) {
                                const cashAvailable = weAlreadyHaveMonopoly 
                                    ? Math.max(0, GameMemory.myCash - 350)
                                    : Math.max(0, GameMemory.myCash - 100);
                                cashOffer = Math.min(cashAvailable, Math.round(Math.abs(cashDiff) * 0.4));
                            }
                        }

                        const cashClause = cashOffer > 0 ? ` + $${cashOffer}` : (cashDemand > 0 ? ` [Demand $${cashDemand}]` : '');
                        opportunities.push({
                            targetOwner: targetOppName,
                            myGivenTile: oppNeed.missingTile,
                            myReceivedTile: myNeed.missingTile,
                            cashOffer: Math.max(0, cashOffer),
                            cashDemand: Math.max(0, cashDemand),
                            summary: `MUTUAL SWAP: Give ${oppNeed.missingTile.name} -> Get ${myNeed.missingTile.name}${cashClause}`,
                            pitch: cashDemand > 0
                                ? `swap ${oppNeed.missingTile.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()} + ${cashDemand}?`
                                : (cashOffer > 0 
                                    ? `swap ${oppNeed.missingTile.name.toLowerCase()} + ${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
                                    : `swap ${oppNeed.missingTile.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()}?`)
                        });
                    }
                }
            }
        }

        // 2. MONOPOLY COMPLETER OFFERS (We need 1 card to complete our set!)
        for (const myNeed of myMissing) {
            if (myNeed.isUnowned) continue;

            const targetOpponents = myNeed.heldBy 
                ? [myNeed.heldBy] 
                : Object.keys(GameMemory.players).filter(p => !GameMemory.isMe(p) && !GameMemory.players[p]?.bankrupt);

            for (const targetOppName of targetOpponents) {
                // Avoid duplicate proposals for the same missing card with this player
                if (opportunities.some(o => o.targetOwner === targetOppName && o.myReceivedTile.id === myNeed.missingTile.id)) continue;

                const sacrificeTile = safeSacrifices.length > 0 ? safeSacrifices[0] : null;

                if (sacrificeTile) {
                    const cashAvailable = weAlreadyHaveMonopoly 
                        ? Math.max(0, GameMemory.myCash - 350)
                        : Math.max(0, GameMemory.myCash - 200);
                    const cashOffer = Math.min(cashAvailable, Math.max(50, Math.round(myNeed.missingTile.price * 0.6)));
                    opportunities.push({
                        targetOwner: targetOppName,
                        myGivenTile: sacrificeTile,
                        myReceivedTile: myNeed.missingTile,
                        cashOffer: Math.max(0, cashOffer),
                        cashDemand: 0,
                        summary: `MONOPOLY ACQUISITION: Give ${sacrificeTile.name} + $${cashOffer} -> Get ${myNeed.missingTile.name}`,
                        pitch: `take ${sacrificeTile.name.toLowerCase()} + ${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
                    });
                } else {
                    const minCashReq = weAlreadyHaveMonopoly ? myNeed.missingTile.price + 450 : myNeed.missingTile.price + 150;
                    if (GameMemory.myCash >= minCashReq) {
                        const reserve = weAlreadyHaveMonopoly ? 350 : 100;
                        const cashOffer = Math.min(GameMemory.myCash - reserve, Math.round(myNeed.missingTile.price * 1.8));
                        opportunities.push({
                            targetOwner: targetOppName,
                            myGivenTile: null,
                            myReceivedTile: myNeed.missingTile,
                            cashOffer: Math.max(80, cashOffer),
                            cashDemand: 0,
                            summary: `CASH ACQUISITION: Offer $${cashOffer} -> Get ${myNeed.missingTile.name}`,
                            pitch: `${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
                        });
                    }
                }
            }
        }

        // 3. SET CONSOLIDATION SWAPS (Only when we do NOT have a monopoly yet!)
        if (!weAlreadyHaveMonopoly) {
            const advancingNeeds = OpponentTracker.getMyAdvancingNeeds();
            for (const need of advancingNeeds) {
                const targetOpponents = need.heldBy
                    ? [need.heldBy]
                    : Object.keys(GameMemory.players).filter(p => !GameMemory.isMe(p) && !GameMemory.players[p]?.bankrupt);

                for (const targetOppName of targetOpponents) {
                    if (opportunities.some(o => o.targetOwner === targetOppName && o.myReceivedTile.id === need.wantedTile.id)) continue;

                    const sacrificeTile = safeSacrifices.find(s => s.id !== need.myTile.id) || null;
                    if (sacrificeTile) {
                        // Anti-Advancement Guard: Never give opponent 2-of-3 in a group more lethal than the group we are advancing!
                        if (sacrificeTile.group) {
                            const oppCount = GameMemory.getGroupCount(sacrificeTile.group, targetOppName);
                            if (oppCount.owned >= 1) {
                                const sacPower = GROUP_POWER[sacrificeTile.group] || 50;
                                const myPower = GROUP_POWER[need.group] || 50;
                                if (sacPower > myPower) continue;
                            }
                        }

                        const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 150), Math.max(20, Math.round(need.wantedTile.price * 0.25)));
                        const cashLabel = cashOffer > 0 ? ` + $${cashOffer}` : '';
                        opportunities.push({
                            targetOwner: targetOppName,
                            myGivenTile: sacrificeTile,
                            myReceivedTile: need.wantedTile,
                            cashOffer: Math.max(0, cashOffer),
                            cashDemand: 0,
                            summary: `SET CONSOLIDATION: Give ${sacrificeTile.name}${cashLabel} -> Get ${need.wantedTile.name}`,
                            pitch: cashOffer > 0 
                                ? `${sacrificeTile.name.toLowerCase()} + ${cashOffer} for ${need.wantedTile.name.toLowerCase()}?`
                                : `swap ${sacrificeTile.name.toLowerCase()} for ${need.wantedTile.name.toLowerCase()}?`
                        });
                    }
                }
            }
        }

        // 4. AIRPORT ACQUISITION (Airport synergy - only in Phase 1 before securing a monopoly)
        if (!weAlreadyHaveMonopoly) {
            const myAirports = BOARD_TILES.filter(t => t.type === 'airport' && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
            if (myAirports.length >= 1 && myAirports.length < 4) {
                const otherAirports = BOARD_TILES.filter(t => t.type === 'airport' && !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
                for (const air of otherAirports) {
                    const holder = GameMemory.ownership[air.id]?.owner;
                    if (holder && !opportunities.some(o => o.targetOwner === holder && o.myReceivedTile.id === air.id)) {
                        const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 200), Math.round(air.price * 1.4));
                        if (cashOffer >= 100) {
                            opportunities.push({
                                targetOwner: holder,
                                myGivenTile: null,
                                myReceivedTile: air,
                                cashOffer,
                                cashDemand: 0,
                                summary: `AIRPORT BUYOUT: Offer $${cashOffer} -> Get ${air.name}`,
                                pitch: `${cashOffer} for ${air.name.toLowerCase()}?`
                            });
                        }
                    }
                }
            }
        }

        // 5. 2-FOR-1 MULTI-ASSET PACKAGE SWAPS (Gap 3: Offer 2 surplus properties for critical 3rd monopoly card)
        if (safeSacrifices.length >= 2) {
            for (const myNeed of myMissing) {
                if (!myNeed.heldBy || myNeed.isUnowned) continue;
                const targetOppName = myNeed.heldBy;
                const s1 = safeSacrifices[0];
                const s2 = safeSacrifices[1];
                const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 200), 50);

                opportunities.push({
                    targetOwner: targetOppName,
                    myGivenTiles: [s1, s2],
                    myReceivedTiles: [myNeed.missingTile],
                    myGivenTile: s1,
                    myReceivedTile: myNeed.missingTile,
                    cashOffer,
                    cashDemand: 0,
                    summary: `2-FOR-1 PACKAGE: Give ${s1.name} & ${s2.name} -> Get ${myNeed.missingTile.name}`,
                    pitch: `take both ${s1.name.toLowerCase()} and ${s2.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()}?`
                });
            }
        }

        // ARCHIVAL DECLINE FILTERING & SWEETENING (Gap 1: Never spam rejected trades; sweeten or pivot!)
        const finalized = [];
        for (const op of opportunities) {
            const givenTiles = Array.isArray(op.myGivenTiles) ? op.myGivenTiles : (op.myGivenTile ? [op.myGivenTile] : []);
            const recTiles = Array.isArray(op.myReceivedTiles) ? op.myReceivedTiles : (op.myReceivedTile ? [op.myReceivedTile] : []);
            const givenIds = givenTiles.map(t => t.id);
            const recIds = recTiles.map(t => t.id);

            if (GameMemory.isTradePreviouslyDeclined(op.targetOwner, givenIds, recIds, op.cashOffer)) {
                // Previously declined! Attempt to sweeten with cash
                const extra = 75;
                if (GameMemory.myCash - (op.cashOffer + extra) >= 150) {
                    op.cashOffer += extra;
                    op.summary += ` [SWEETENED +$${extra}]`;
                    op.pitch = `${op.pitch.replace(/\?$/, '')} + ${op.cashOffer}?`;
                    logToBot(`[TRADE ENGINE] 🍯 Sweetened previously declined trade for ${op.targetOwner}: increased cash to $${op.cashOffer}`);
                    finalized.push(op);
                } else if (givenTiles.length === 1 && safeSacrifices.length >= 2) {
                    // Upgrade to 2-for-1 package
                    const s2 = safeSacrifices.find(s => s.id !== givenTiles[0].id);
                    if (s2) {
                        op.myGivenTiles = [givenTiles[0], s2];
                        op.myGivenTile = null;
                        op.summary = `2-FOR-1 SWEETENED: Give ${givenTiles[0].name} & ${s2.name} -> Get ${recTiles[0]?.name || 'property'}`;
                        op.pitch = `what about ${givenTiles[0].name.toLowerCase()} AND ${s2.name.toLowerCase()} for ${recTiles[0]?.name?.toLowerCase()}?`;
                        logToBot(`[TRADE ENGINE] 🎁 Upgraded declined trade to 2-for-1 package: [${givenTiles[0].name}, ${s2.name}]`);
                        finalized.push(op);
                    }
                }
                // If cannot sweeten with cash or extra property, skip to respect player's archival rejection!
            } else {
                finalized.push(op);
            }
        }

        return finalized;
    }
};
