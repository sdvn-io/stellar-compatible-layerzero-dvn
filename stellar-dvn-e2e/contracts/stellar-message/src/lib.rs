#![no_std]

use common_macros::{contract_impl, lz_contract};
use endpoint_v2::{LayerZeroEndpointV2Client, MessagingFee, Origin};
use oapp::{
    oapp_core::init_ownable_oapp,
    oapp_receiver::{LzReceiveInternal, OAppReceiver},
    oapp_sender::{FeePayer, OAppSenderInternal},
};
use oapp_macros::oapp;
use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Bytes, BytesN, Env};

const MAX_MESSAGE_BYTES: u32 = 256;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MessageError {
    EmptyMessage = 1,
    MessageTooLong = 2,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Eid,
    LastMessage,
    LastSourceEid,
    LastSender,
    LastGuid,
    ReceivedMessageCount,
    SentMessageCount,
}

fn validate_message(env: &Env, message: &Bytes) {
    if message.is_empty() {
        panic_with_error!(env, MessageError::EmptyMessage);
    }
    if message.len() > MAX_MESSAGE_BYTES {
        panic_with_error!(env, MessageError::MessageTooLong);
    }
}

#[lz_contract]
#[oapp(custom = [receiver])]
pub struct MessageOApp;

#[contract_impl]
impl MessageOApp {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, delegate: &Address) {
        init_ownable_oapp::<Self>(env, owner, endpoint, delegate);
        let eid = LayerZeroEndpointV2Client::new(env, endpoint).eid();
        env.storage().instance().set(&DataKey::Eid, &eid);
    }

    pub fn quote(env: &Env, dst_eid: u32, message: &Bytes, options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        validate_message(env, message);
        Self::__quote(env, dst_eid, message, options, pay_in_zro)
    }

    pub fn send_message(
        env: &Env,
        caller: &Address,
        dst_eid: u32,
        message: &Bytes,
        options: &Bytes,
        fee: &MessagingFee,
    ) {
        caller.require_auth();
        validate_message(env, message);
        let count = Self::sent_message_count(env);
        env.storage().instance().set(&DataKey::SentMessageCount, &(count + 1));
        Self::__lz_send(env, dst_eid, message, options, &FeePayer::Verified(caller.clone()), fee, caller);
    }

    pub fn eid(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::Eid).unwrap()
    }

    pub fn last_message(env: &Env) -> Bytes {
        env.storage().instance().get(&DataKey::LastMessage).unwrap_or(Bytes::new(env))
    }

    pub fn last_source_eid(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::LastSourceEid).unwrap_or(0)
    }

    pub fn last_sender(env: &Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::LastSender).unwrap_or(BytesN::from_array(env, &[0; 32]))
    }

    pub fn last_guid(env: &Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::LastGuid).unwrap_or(BytesN::from_array(env, &[0; 32]))
    }

    pub fn received_message_count(env: &Env) -> u64 {
        env.storage().instance().get(&DataKey::ReceivedMessageCount).unwrap_or(0)
    }

    pub fn sent_message_count(env: &Env) -> u64 {
        env.storage().instance().get(&DataKey::SentMessageCount).unwrap_or(0)
    }
}

impl LzReceiveInternal for MessageOApp {
    fn __lz_receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        validate_message(env, message);
        let count = Self::received_message_count(env);
        env.storage().instance().set(&DataKey::LastMessage, message);
        env.storage().instance().set(&DataKey::LastSourceEid, &origin.src_eid);
        env.storage().instance().set(&DataKey::LastSender, &origin.sender);
        env.storage().instance().set(&DataKey::LastGuid, guid);
        env.storage().instance().set(&DataKey::ReceivedMessageCount, &(count + 1));
    }
}

#[contract_impl(contracttrait)]
impl OAppReceiver for MessageOApp {
    fn next_nonce(_env: &Env, _src_eid: u32, _sender: &BytesN<32>) -> u64 {
        0
    }
}
