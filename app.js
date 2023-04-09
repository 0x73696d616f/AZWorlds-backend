const { ethers, JsonRpcProvider } = require('ethers');
const characterSaleABI = require("./contracts/CharacterSale.json");
const itemABI = require("./contracts/Item.json");
const goldABI = require("./contracts/Gold.json");
require("dotenv").config();
const { createClient } = require('@supabase/supabase-js')
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const supabaseUrl = 'https://wylvkxjtrqxesqarblyf.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const goldAddress = "0x07999BA0f49a13bE07EE9Ac43653F18c2CA5a6c6";
const characterSaleAddress = "0x010BB403613d2a71cD7119849239C4eb2DA79a4c";
const itemAddress = "0xaf450dE59034ccD2434885d8bAb97fb7Dbe13817";

async function bootstrapDatabase(rpcUrl, chain, chainName) {
    const provider = new JsonRpcProvider(rpcUrl);
    let contract = new ethers.Contract(characterSaleAddress, characterSaleABI, provider);

    let data = {};

    await supabase.from(chain).delete().neq('address', '0');

    let events = await contract.queryFilter("CharacterBought", 0, "latest");
    events.map(async (event) => {
        const cid = event.args.tokenURI.slice(7, event.args.tokenURI.length-14);
        const metadataUrl = `https://ipfs.io/ipfs/${cid}/metadata.json`;
        const metadata = await fetch(metadataUrl);
        const metadataJson = await metadata.json();

        if(!characterData[event.args.charId]) characterData[event.args.charId] = {};
        if(!characterData[event.args.charId]["charId"]) characterData[event.args.charId]["charId"] = event.args.charId.toString();
        characterData[event.args.charId]["buyPrice"] = event.args.price.toString();
        characterData[event.args.charId]["url"] = event.args.tokenURI;
        if(!characterData[event.args.charId]["owner"]) characterData[event.args.charId]["owner"] = event.args.buyer;
        characterData[event.args.charId]["img"] = metadataJson.image;
        if(!characterData[event.args.charId]["currentChain"]) characterData[event.args.charId]["currentChain"] = chainName;
        characterData[event.args.charId]["level"] = (BigInt(characterData[event.args.charId]["level"] || 0) + BigInt(1)).toString();
        characterData[event.args.charId]["power"] = (BigInt(characterData[event.args.charId]["power"] || 0) + BigInt(1000)).toString();
        if(!characterData[event.args.charId]["equippedItems"]) characterData[event.args.charId]["equippedItems"] = {};
        if(!characterData[event.args.charId]["equippedGold"]) characterData[event.args.charId]["equippedGold"] = 0;
    });
    
    events = await contract.queryFilter("ItemsEquipped", 0, "latest");
    events.map((event) => {
        if(!characterData[event.args.charId]) characterData[event.args.charId] = {};
        if(!characterData[event.args.charId]["equippedItems"]) characterData[event.args.charId]["equippedItems"] = {};
        event.args.itemIds.map((itemId) => {
            characterData[event.args.charId]["equippedItems"][itemId] = (BigInt(characterData[event.args.charId]["equippedItems"][itemId] || 0) + BigInt(1)).toString();
            characterData[event.args.charId]["power"] = (BigInt(characterData[event.args.charId]["power"] || 0) + BigInt(itemId)).toString();
        });
    });

    events = await contract.queryFilter("GoldCarried", 0, "latest");        
    events.map(async (event) => {
        if(!characterData[event.args.charId]) characterData[event.args.charId] = {};
        characterData[event.args.charId]["equippedGold"] = (BigInt(characterData[event.args.charId]["equippedGold"] || 0) + BigInt(event.args.goldAmount)).toString();
    });

    events = await contract.queryFilter("GoldDropped", 0, "latest");
    events.map(async (event) => {
        if(!characterData[event.args.charId]) characterData[event.args.charId] = {};
        characterData[event.args.charId]["equippedGold"] = (BigInt(characterData[event.args.charId]["equippedGold"] || 0) - BigInt(event.args.goldAmount)).toString();
    });

    events = await contract.queryFilter("CharacterLevelUp", 0, "latest");
    events.map(async (event) => {
        if(!characterData[event.args.charId]) characterData[event.args.charId] = {};
        characterData[event.args.charId]["level"] = (BigInt(characterData[event.args.charId]["level"] || 0) + BigInt(1)).toString();
        characterData[event.args.charId]["power"] = (BigInt(characterData[event.args.charId]["power"] || 0) + BigInt(1000)).toString();
    });

    events = await contract.queryFilter("Transfer", 0, "latest");
    events.map((event) => {
        bootstrapNFTAdd(data, "charIds", event.args.from, event.args.to, event.args.tokenId, 1)
    });

    contract = new ethers.Contract(itemAddress, itemABI, provider);

    events = await contract.queryFilter("TransferSingle", 0, "latest");
    events.map((event) => bootstrapNFTAdd(data, "itemIds", event.args.from, event.args.to, event.args.id, event.args.value));

    events = await contract.queryFilter("TransferBatch", 0, "latest");
    events.map((event) => {
        for (let i = 0; i < event.args.ids.length; i++) {
            bootstrapNFTAdd(data, "itemIds", event.args.from, event.args.to, event.args.ids[i], Object.entries(event.args)[4][1][i])
        }
    });

    contract = new ethers.Contract(goldAddress, goldABI, provider);

    events = await contract.queryFilter("Transfer", 0, "latest");
    events.map((event) => {
        if (!data[event.args.from]) data[event.args.from] = {};
        data[event.args.from].gold = (BigInt(data[event.args.from].gold || 0) - event.args.value).toString();
        if (!data[event.args.to]) data[event.args.to] = {};
        data[event.args.to].gold = (BigInt(data[event.args.to].gold || 0) + event.args.value).toString();
    });

    let tableData = [];
    for (let [address, row] of Object.entries(data)) {
        row.address = address;
        if(row.itemIds) Object.entries(row.itemIds).forEach((itemIdAmount, index) => {if (itemIdAmount[1] === "0") delete row.itemIds[itemIdAmount[0]]});
        if(row.charIds) Object.entries(row.charIds).forEach((charIdAmount, index) => {
            if (charIdAmount[1] === "0") delete row.charIds[charIdAmount[0]];
            else if (address !== characterSaleAddress && address !== "0x0000000000000000000000000000000000000000") {
                if(!characterData[charIdAmount[0]]) characterData[charIdAmount[0]] = {};
                characterData[charIdAmount[0]].owner = address;
                characterData[charIdAmount[0]].currentChain = chainName;
            }
        });
        if (row.charIds) row.charIds=Object.keys(row.charIds);
        tableData.push(row)
    }

    await supabase.from(chain).insert(tableData);

    console.log("Database " + chain + " bootstrapped");
}

async function onContractEvents(rpcUrl, chain, chainName, isFuji) {
    const provider = new JsonRpcProvider(rpcUrl);
    let contract = new ethers.Contract(characterSaleAddress, characterSaleABI, provider);

    contract.on("CharacterBought", async (buyer, charId, price, tokenURI) => {
        console.log("Character Bought " + "buyer " + buyer + " charId " + charId + " price " + price + " tokenURI " + tokenURI);
        try {
            createCharacter(buyer, charId, price, tokenURI, chainName);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("ItemsEquipped", async (charId, itemIds) => {
        console.log("Items Equipped " + "charId " + charId + " itemIds " + itemIds);
        try {
            updateItemsEquipped(charId, itemIds);
        } catch (error) {
            console.log(error);
        }
    });
    contract.on("GoldCarried", async (charId, amount) => {
        console.log("Gold Carried " + "charId " + charId + " amount " + amount);
        try {
            updateGoldCarried(charId, amount);
        } catch (error) {
            console.log(error);
        }
    });
    contract.on("GoldDropped", async (charId, amount) => { 
        console.log("Gold Dropped " + "charId " + charId + " amount " + amount);
        try {
            updateGoldCarried(charId, -amount);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("Transfer", async (from, to, charId) => {
        if (from == to) return;
        console.log("Character Transfer " + "from " + from + " to " + to + " charId " + charId);
        try {
            updateCharId(chain, from, to, charId, chainName);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("CharacterLevelUp", async (charId, level) => {
        console.log("Character Level Up " + "charId " + charId + " level " + level)
        try {
            updateLevelAndPower(charId, level);
        } catch (error) {
            console.log(error);
        }
    });

    contract = new ethers.Contract(itemAddress, itemABI, provider);

    contract.on("TransferSingle", async (operator, from, to, id, amount) => {
        if (from == to) return;
        console.log("Item Transfer " + "from " + from + " to " + to + " id " + id + " amount " + amount);
        try {
            updateItemId(chain, from, to, id, amount);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("TransferBatch", async (operator, from, to, ids, amounts) => {
        if (from == to) return;
        console.log("Item Transfer " + "from " + from + " to " + to + " ids " + ids + " amounts " + amounts);
        try {
            for (let i = 0; i < ids.length; i++) {
                updateItemId(chain, from, to, ids[i], amounts[i]);
            }
        } catch (error) {
            console.log(error);
        }
    });

    contract = new ethers.Contract(goldAddress, goldABI, provider);

    contract.on("Transfer", async (from, to, amount) => {
        if (from == to) return;
        console.log("Gold Transfer " + "from " + from + " to " + to + " amount " + amount);
        try {
            updateGold(chain, from, to, amount);
        } catch (error) {
            console.log(error);
        }
    });
}

async function createCharacter(buyer, charId, price, tokenURI, chainName) {
    const cid = tokenURI.slice(7, tokenURI.length-14);
    const metadataUrl = `https://ipfs.io/ipfs/${cid}/metadata.json`;
    const metadata = await fetch(metadataUrl);
    const metadataJson = await metadata.json();
                
    let { data, error } = await supabase
        .from('Character')
        .insert([
            {
                charId: charId.toString(),
                level: "1",
                power: "1000",
                buyPrice: price.toString(),
                equippedItems: [],
                equippedGold: "0",
                url: tokenURI,
                owner: buyer.toString(),
                img: metadataJson.image,
                currentChain: chainName,
            }
        ])
    if (error) console.log(error);
}

async function updateGoldCarried(charId, amount) {
    let { data, error } = await supabase
        .from('Character')
        .select('equippedGold')
        .eq('charId', charId.toString())

    data[0].equippedGold = (BigInt(amount) + BigInt(data[0].equippedGold || 0)).toString();
    ({ data, error } = await supabase
        .from('Character')
        .update({equippedGold : data[0].equippedGold})
        .eq('charId', charId.toString()))
    if(error) console.log(error);
}

async function updateItemsEquipped(charId, itemIds) {
    let { data, error } = await supabase
        .from('Character')
        .select('equippedItems,power')
        .eq('charId', charId.toString())
    if (error) console.log(error);

    for (let i = 0; i < itemIds.length; i++) {
        data[0].equippedItems.push(itemIds[i].toString());
        data[0].power = (BigInt(data[0].power) + BigInt(itemIds[i])).toString();
    }
    ({data, error} = await supabase
        .from('Character')
        .update({equippedItems : data[0].equippedItems, power : data[0].power})
        .eq('charId', charId.toString()));
    if(error) console.log(error);
}

async function updateLevelAndPower(charId, level) {
    let { data, error } = await supabase
        .from('Character')
        .select('power,level')
        .eq('charId', charId.toString())
    if (error) console.log(error);

    ({data,error} = await supabase
        .from('Character')
        .update({level : (BigInt(data[0].level) + BigInt(1)).toString(), power : (BigInt(data[0].power) + BigInt(1000)).toString()})
        .eq('charId', charId.toString()));
    if(error) console.log(error);
}

async function updateCharId(chain, from, to, id, chainName) {
    const updateCharIdsArray = (address, isAdding, addressData) => {
        if (Object.keys(addressData).length === 0 || !Array.isArray(addressData.charIds)) {
            addressData = {address: address, charIds: [id.toString()]};
            return addressData;
        } 
        if(isAdding) {
            addressData.charIds.push(id.toString());
            return addressData;
        };

        let index = addressData.charIds.indexOf(id.toString());
        if (index !== -1) {
            addressData.charIds.splice(index, 1);
        } else {
            addressData.charIds.push(id.toString()); // 0 address keeps track of minted ids
        }
        return addressData;
    }

    let [fromData, toData] = await fetchFromToData(chain, from, to, "charIds");

    fromData = updateCharIdsArray(from.toString(), false, fromData);
    toData = updateCharIdsArray(to.toString(), true, toData);

    ({ data, error } = await supabase
        .from(chain)
        .upsert([fromData, toData]))
    if (error) console.log(error);

    if (to.toString() === characterSaleAddress) return;
    
    ({ data, error } = await supabase
        .from("Character")
        .update({owner: to.toString(), currentChain: chainName.toString()})
        .eq('charId', id.toString()));
    if (error) console.log(error);
}

async function updateItemId(chain, from, to, id, amount) {
    const updateItemIdsObject = (address, addressAmount, addressData) => {
        let itemIds = {};
        if (Object.keys(addressData).length === 0) {
            itemIds[id] = addressAmount.toString();
            addressData = {address: address, itemIds: itemIds};
        } else {
            itemIds = JSON.parse(addressData.itemIds);
            itemIds[id] = itemIds[id] ? (addressAmount + BigInt(itemIds[id])).toString() : addressAmount.toString();
            if (itemIds[id] === "0") delete itemIds[id];
            addressData.itemIds=JSON.stringify(itemIds);
        } 
        return addressData;
    }
    id = id.toString();
    let [fromData, toData] = await fetchFromToData(chain, from, to, "itemIds");

    fromData = updateItemIdsObject(from.toString(), -BigInt(amount), fromData);
    toData = updateItemIdsObject(to.toString(), BigInt(amount), toData);

    ({ data, error } = await supabase
        .from(chain)
        .upsert([fromData, toData]))
    if (error) console.log(error);
}

async function updateGold(chain, from, to, amount) {
    const updateGoldData = function(address, addressAmount, addressData) {        
        if (Object.keys(addressData).length === 0) {
            addressData = {address: address, gold: addressAmount.toString()};
        } else {
            addressData.gold = (BigInt(addressData.gold || 0) + addressAmount).toString();
        } 
        return addressData;
    }

    let [fromData, toData] = await fetchFromToData(chain, from, to, "gold");

    fromData = updateGoldData(from.toString(), -BigInt(amount || 0), fromData);
    toData = updateGoldData(to.toString(), BigInt(amount || 0), toData);

    ({data, error} = await supabase
        .from(chain)
        .upsert([fromData, toData]))
    if (error) console.log(error);
}

async function fetchFromToData(chain, from, to, column) {
    let { data, error } = await supabase
    .from(chain)
    .select(`address,${column}`)
    .filter('address', 'in', `("${from.toString()}","${to.toString()}")`)
    if (error) console.log(error);
    let fromData = {};
    let toData = {};
    if (data.length === 1) {
        if(data[0].address.toString() === from.toString()) fromData =  data[0];
        if(data[0].address.toString() === to.toString()) toData =  data[0];
    } else if (data.length === 2){
        fromData = data[0].address.toString() === from.toString() ? data[0] : data[1];
        toData = data[0].address.toString() === to.toString() ? data[0] : data[1];
    }
    return [fromData, toData];
}

function bootstrapNFTAdd(data, key, from, to, id, value) {
    if (!data[from]) data[from] = {};
    if (!data[from][key]) data[from][key] = {};
    data[from][key][id] = (BigInt(data[from][key][id] || 0) - BigInt(value)).toString();
    if (!data[to]) data[to] = {};
    if (!data[to][key]) data[to][key] = {};
    data[to][key][id] = (BigInt(data[to][key][id] || 0) + BigInt(value)).toString();
    return data;
}

// Character table is the same across all blockchains
const deleteCharacterDatabase = async () => {
    let {data, error} = await supabase.from("Character").delete().neq('charId', '0');
    if (error) console.log(error);
}

const createCharacterDatabase = async (tableData) => {
    let {data, error} = await supabase.from("Character").insert(tableData);
    if (error) console.log(error);
}

let characterData = {};

const bootstrapDatabases = async () => {
    await deleteCharacterDatabase();
    
    await bootstrapDatabase(process.env.RPC_URL_SEPOLIA, "UserInfoChain1", "Sepolia");
    await bootstrapDatabase(process.env.RPC_URL_MUMBAI, "UserInfoChain2", "Mumbai");
    //await bootstrapDatabase(process.env.RPC_URL_FUJI, "UserInfoChain3", "Fuji", true);

    let characterTableData = [];
    for (let [charId, row] of Object.entries(characterData)) {
        row.charId = charId;
        if(row.equippedItems) row.equippedItems = Object.keys(row.equippedItems);
        characterTableData.push(row)
    }

    await createCharacterDatabase(characterTableData);
}

bootstrapDatabases();
onContractEvents(process.env.RPC_URL_SEPOLIA, "UserInfoChain1", "Sepolia");
onContractEvents(process.env.RPC_URL_MUMBAI, "UserInfoChain2", "Mumbai");
// fuji does not support eth_newFilter
//onContractEvents(process.env.RPC_URL_FUJI, "UserInfoChain3", "Fuji", true);
